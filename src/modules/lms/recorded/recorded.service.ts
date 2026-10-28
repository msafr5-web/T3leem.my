import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import type {
  CreatePostResult,
  DiscussionPostRow,
  RecordedCourseDetail,
  RecordedCourseRepository,
  RecordedCourseSummary,
  RecordedSchedule,
  RecordedSourceMeta,
} from './recorded.repository';
import { DEFAULT_SCHEDULE, ScheduleError, formatTimestamp, planSchedule, type ScheduleConfig, type SchedulePlan } from './schedule-planner';
import { normalizeChannelUrl, parseYoutubeVideoId, type YoutubeMetadataSource, type YoutubeVideoInfo } from './youtube';

export interface ScheduleRequest {
  youtubeUrl: string;
  /** null = derived from the daily video target. */
  days: number | null;
  config: Partial<ScheduleConfig>;
  /** Used only when YouTube can't tell us the duration. */
  manualDurationSeconds: number | null;
}

/** Supervisor-entered source details; empty values fall back to what YouTube reports. */
export interface SourceInput {
  channelUrl: string | null;
  channelName: string | null;
  startsAt: Date | null;
}

export interface SchedulePreview {
  video: YoutubeVideoInfo & { durationSeconds: number; durationSource: 'youtube' | 'manual' };
  config: ScheduleConfig;
  plan: SchedulePlan;
}

export interface CreateRecordedCourseInput extends ScheduleRequest, SourceInput {
  title: string | null;
  description: string | null;
  trainerId: string;
  price: string;
  isPublished: boolean;
}

export interface RecordedCourseServiceDeps {
  repository: RecordedCourseRepository;
  youtube: YoutubeMetadataSource;
}

const STAFF_ROLES = new Set(['TENANT_ADMIN', 'INSTRUCTOR', 'SUPER_ADMIN']);

/**
 * "Recorded courses" (دورات مسجلة): a course built from one long YouTube video, split into
 * days of short lectures with breaks and a daily discussion. Days are modules and lectures are
 * YOUTUBE lessons, so catalog, checkout, ZATCA invoices, progress and certificates all apply
 * unchanged.
 */
export class RecordedCourseService {
  constructor(private readonly deps: RecordedCourseServiceDeps) {}

  async preview(req: ScheduleRequest): Promise<SchedulePreview> {
    const videoId = parseYoutubeVideoId(req.youtubeUrl);
    if (!videoId) throw HttpError.unprocessable('INVALID_YOUTUBE_URL', 'Enter a valid YouTube video link');

    // The duration is always looked up server-side; a client-supplied value is trusted only as
    // a fallback when YouTube can't answer (otherwise a wrong number would cut the video short).
    const found = await this.deps.youtube.lookup(videoId);
    if (found.kind === 'not_found') throw HttpError.unprocessable('YOUTUBE_VIDEO_NOT_FOUND', 'This YouTube video does not exist or is private');
    if (found.kind === 'not_embeddable') throw HttpError.unprocessable('YOUTUBE_NOT_EMBEDDABLE', 'The owner of this video does not allow playing it on other sites');

    const info: YoutubeVideoInfo = found.kind === 'ok' ? found.info : { videoId, title: '', channel: '', channelUrl: null, durationSeconds: null };
    const durationSeconds = info.durationSeconds ?? req.manualDurationSeconds;
    if (!durationSeconds) {
      throw HttpError.unprocessable('YOUTUBE_DURATION_UNKNOWN', 'Could not read the video duration from YouTube; enter it manually');
    }

    const config: ScheduleConfig = { ...DEFAULT_SCHEDULE, ...req.config };
    if (config.minLectureMinutes > config.maxLectureMinutes) config.minLectureMinutes = config.maxLectureMinutes;
    let plan: SchedulePlan;
    try {
      plan = planSchedule(durationSeconds, config, req.days);
    } catch (err) {
      if (err instanceof ScheduleError) throw HttpError.unprocessable(err.code, err.message);
      throw err;
    }
    return { video: { ...info, durationSeconds, durationSource: info.durationSeconds ? 'youtube' : 'manual' }, config, plan };
  }

  /** Supervisor input wins; otherwise the channel YouTube reports for the video. */
  private resolveSource(input: SourceInput, video?: YoutubeVideoInfo): RecordedSourceMeta {
    let channelUrl = video?.channelUrl ?? null;
    if (input.channelUrl) {
      channelUrl = normalizeChannelUrl(input.channelUrl);
      if (!channelUrl) throw HttpError.unprocessable('INVALID_CHANNEL_URL', 'Enter a YouTube channel link such as https://www.youtube.com/@name');
    }
    const channelName = (input.channelName ?? '').trim() || video?.channel.trim() || null;
    return { channelUrl, channelName: channelName ? channelName.slice(0, 120) : null, startsAt: input.startsAt };
  }

  private schedule(preview: SchedulePreview, source: RecordedSourceMeta): RecordedSchedule {
    const multiDay = preview.plan.days.length > 1;
    return {
      ...source,
      videoId: preview.video.videoId,
      durationSeconds: preview.video.durationSeconds,
      config: preview.config,
      trainingHours: preview.plan.trainingHours,
      days: preview.plan.days.map((d) => ({
        title: multiDay ? `اليوم ${d.day}` : 'اليوم 1',
        lessons: d.lectures.map((l, i) => ({
          title: `الجزء ${i + 1} (${formatTimestamp(l.startSecond)} – ${formatTimestamp(l.endSecond)})`,
          startSecond: l.startSecond,
          endSecond: l.endSecond,
        })),
      })),
    };
  }

  async create(tenantId: string, actor: Actor, input: CreateRecordedCourseInput): Promise<{ id: string; preview: SchedulePreview }> {
    const preview = await this.preview(input);
    const title = (input.title ?? '').trim() || preview.video.title.trim();
    if (title.length < 3) throw HttpError.unprocessable('TITLE_REQUIRED', 'Enter a course title');
    const schedule = this.schedule(preview, this.resolveSource(input, preview.video));

    const id = await this.deps.repository.createRecordedCourse(tenantId, actor, {
      ...schedule,
      title: title.slice(0, 200),
      description: input.description,
      trainerId: input.trainerId,
      price: input.price,
      isPublished: input.isPublished,
    });
    if (!id) throw HttpError.unprocessable('UNKNOWN_TRAINER', 'Trainer not found in this academy');
    return { id, preview };
  }

  /** Turns an existing course (from the regular course form) into a recorded YouTube course. */
  async attach(tenantId: string, actor: Actor, courseId: string, input: ScheduleRequest & SourceInput): Promise<SchedulePreview> {
    const preview = await this.preview(input);
    const result = await this.deps.repository.attachRecordedSchedule(tenantId, actor, courseId, this.schedule(preview, this.resolveSource(input, preview.video)));
    if (result === 'not_found') throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    if (result === 'has_content') throw HttpError.conflict('COURSE_HAS_CONTENT', 'This course already has content; a YouTube schedule can only be added to an empty course');
    return preview;
  }

  async updateSource(tenantId: string, actor: Actor, courseId: string, input: SourceInput): Promise<void> {
    if (!(await this.deps.repository.updateRecordedSource(tenantId, actor, courseId, this.resolveSource(input)))) {
      throw HttpError.notFound('COURSE_NOT_FOUND', 'Recorded course not found');
    }
  }

  list(tenantId: string): Promise<RecordedCourseSummary[]> {
    return this.deps.repository.listRecordedCourses(tenantId);
  }

  async get(tenantId: string, courseId: string): Promise<RecordedCourseDetail> {
    const course = await this.deps.repository.getRecordedCourse(tenantId, courseId);
    if (!course) throw HttpError.notFound('COURSE_NOT_FOUND', 'Recorded course not found');
    return course;
  }

  /** Learners see a day's board only if enrolled; academy staff see every board in the academy. */
  private async assertCanAccess(tenantId: string, user: { id: string; role: string }, moduleId: string): Promise<void> {
    const allowed = STAFF_ROLES.has(user.role)
      ? await this.deps.repository.moduleExists(tenantId, moduleId)
      : await this.deps.repository.isEnrolledInModule(tenantId, user.id, moduleId);
    // Same answer for "no such day" and "not enrolled": don't reveal course structure.
    if (!allowed) throw HttpError.forbidden('Enroll in this course to join its discussion');
  }

  async listDiscussion(tenantId: string, user: { id: string; role: string }, moduleId: string): Promise<DiscussionPostRow[]> {
    await this.assertCanAccess(tenantId, user, moduleId);
    return this.deps.repository.listDiscussion(tenantId, moduleId, user.id);
  }

  async post(tenantId: string, user: { id: string; role: string }, moduleId: string, body: string, parentId: string | null): Promise<string> {
    await this.assertCanAccess(tenantId, user, moduleId);
    const text = body.trim();
    if (text.length < 2) throw HttpError.unprocessable('POST_TOO_SHORT', 'Write your question first');
    const result: CreatePostResult = await this.deps.repository.createPost(tenantId, user.id, moduleId, parentId, text.slice(0, 2000));
    if (result.kind === 'module_not_found') throw HttpError.forbidden('Enroll in this course to join its discussion');
    if (result.kind === 'parent_not_found') throw HttpError.notFound('POST_NOT_FOUND', 'The question you are replying to no longer exists');
    return result.id;
  }
}
