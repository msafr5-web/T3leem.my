/** In-memory recorded-course repository + YouTube source for HTTP contract tests. */
import type { UserRole } from '@prisma/client';
import type { DiscussionPostRow, NewRecordedCourse, RecordedCourseRepository } from '../../../src/modules/lms/recorded/recorded.repository';
import { RecordedCourseService } from '../../../src/modules/lms/recorded/recorded.service';
import type { YoutubeLookup, YoutubeMetadataSource } from '../../../src/modules/lms/recorded/youtube';

/** 21 min 5 s, embeddable — mirrors the real trial video. */
export const YT_OK = 'ZJQ-c4HyeX8';
export const YT_PRIVATE = 'privateVid1';
export const YT_NO_EMBED = 'noEmbedVid1';
export const YT_NO_DURATION = 'noDuration1';

export function buildRecordedFakes(ids: { tenantA: string; trainer: string; users: Record<string, { name: string; role: UserRole }> }) {
  const courses = new Map<string, NewRecordedCourse & { tenantId: string; moduleIds: string[] }>();
  const modules = new Map<string, { tenantId: string; courseId: string; title: string }>();
  const enrollments = new Set<string>(); // `${userId}:${courseId}`
  /** Regular courses from the course form (not yet recorded): id → tenant + whether they have content. */
  const plainCourses = new Map<string, { tenantId: string; hasContent: boolean }>();
  const posts: { id: string; tenantId: string; moduleId: string; userId: string; parentId: string | null; body: string; createdAt: Date }[] = [];
  let seq = 0;
  const nextId = (_kind: string) => `00000000-${String(++seq).padStart(4, '0')}-4000-8000-000000000000`;

  const youtube: YoutubeMetadataSource = {
    lookup: async (videoId): Promise<YoutubeLookup> => {
      if (videoId === YT_OK) {
        return { kind: 'ok', info: { videoId, title: 'تعلم GitHub في أقل من 30 دقيقة', channel: 'Syntax', channelUrl: 'https://www.youtube.com/@mostfa-syntax', durationSeconds: 1265 } };
      }
      if (videoId === YT_PRIVATE) return { kind: 'not_found' };
      if (videoId === YT_NO_EMBED) return { kind: 'not_embeddable' };
      if (videoId === YT_NO_DURATION) return { kind: 'ok', info: { videoId, title: 'Long talk', channel: 'X', channelUrl: null, durationSeconds: null } };
      return { kind: 'not_found' };
    },
  };

  const view = (p: (typeof posts)[number], viewer: string): Omit<DiscussionPostRow, 'replies'> => ({
    id: p.id,
    body: p.body,
    createdAt: p.createdAt,
    authorName: ids.users[p.userId]?.name ?? 'user',
    authorRole: ids.users[p.userId]?.role ?? 'LEARNER',
    mine: p.userId === viewer,
  });

  const repository: RecordedCourseRepository = {
    createRecordedCourse: async (tenantId, _actor, input) => {
      if (tenantId !== ids.tenantA || input.trainerId !== ids.trainer) return null;
      const id = nextId('course');
      const moduleIds = input.days.map((d) => {
        const mid = nextId('module');
        modules.set(mid, { tenantId, courseId: id, title: d.title });
        return mid;
      });
      courses.set(id, { ...input, tenantId, moduleIds });
      return id;
    },
    attachRecordedSchedule: async (tenantId, _actor, courseId, schedule) => {
      const plain = plainCourses.get(courseId);
      if (courses.has(courseId)) return courses.get(courseId)!.tenantId === tenantId ? 'has_content' : 'not_found';
      if (!plain || plain.tenantId !== tenantId) return 'not_found';
      if (plain.hasContent) return 'has_content';
      const moduleIds = schedule.days.map((d) => {
        const mid = nextId('module');
        modules.set(mid, { tenantId, courseId, title: d.title });
        return mid;
      });
      courses.set(courseId, { ...schedule, title: 'Plain course', description: null, trainerId: ids.trainer, price: '0.00', isPublished: false, tenantId, moduleIds });
      plainCourses.delete(courseId);
      return 'ok';
    },
    updateRecordedSource: async (tenantId, _actor, courseId, meta) => {
      const c = courses.get(courseId);
      if (!c || c.tenantId !== tenantId) return false;
      Object.assign(c, meta);
      return true;
    },
    listRecordedCourses: async (tenantId) =>
      [...courses.entries()]
        .filter(([, c]) => c.tenantId === tenantId)
        .map(([id, c]) => ({
          id,
          title: c.title,
          isPublished: c.isPublished,
          videoId: c.videoId,
          durationSeconds: c.durationSeconds,
          dayCount: c.days.length,
          lectureCount: c.days.reduce((s, d) => s + d.lessons.length, 0),
          enrollmentCount: [...enrollments].filter((e) => e.endsWith(`:${id}`)).length,
          postCount: posts.filter((p) => c.moduleIds.includes(p.moduleId)).length,
        })),
    getRecordedCourse: async (tenantId, courseId) => {
      const c = courses.get(courseId);
      if (!c || c.tenantId !== tenantId) return null;
      return {
        id: courseId,
        title: c.title,
        isPublished: c.isPublished,
        videoId: c.videoId,
        durationSeconds: c.durationSeconds,
        enrollmentCount: 0,
        config: c.config,
        trainingHours: c.trainingHours,
        channelUrl: c.channelUrl,
        channelName: c.channelName,
        startsAt: c.startsAt,
        days: c.days.map((d, i) => ({
          id: c.moduleIds[i] ?? '',
          title: d.title,
          postCount: posts.filter((p) => p.moduleId === c.moduleIds[i]).length,
          lessons: d.lessons.map((l, j) => ({ id: `${c.moduleIds[i]}-${j}`, ...l })),
        })),
      };
    },
    isEnrolledInModule: async (tenantId, userId, moduleId) => {
      const m = modules.get(moduleId);
      return !!m && m.tenantId === tenantId && enrollments.has(`${userId}:${m.courseId}`);
    },
    moduleExists: async (tenantId, moduleId) => modules.get(moduleId)?.tenantId === tenantId,
    listDiscussion: async (tenantId, moduleId, viewer) =>
      posts
        .filter((p) => p.tenantId === tenantId && p.moduleId === moduleId && p.parentId === null)
        .map((p) => ({ ...view(p, viewer), replies: posts.filter((r) => r.parentId === p.id).map((r) => view(r, viewer)) })),
    createPost: async (tenantId, userId, moduleId, parentId, body) => {
      if (modules.get(moduleId)?.tenantId !== tenantId) return { kind: 'module_not_found' };
      if (parentId && !posts.some((p) => p.id === parentId && p.moduleId === moduleId && p.parentId === null)) return { kind: 'parent_not_found' };
      const id = nextId('post');
      posts.push({ id, tenantId, moduleId, userId, parentId, body, createdAt: new Date() });
      return { kind: 'ok', id };
    },
  };

  return {
    service: new RecordedCourseService({ repository, youtube }),
    courses,
    posts,
    enroll: (userId: string, courseId: string) => enrollments.add(`${userId}:${courseId}`),
    addPlainCourse: (tenantId: string, courseId: string, hasContent = false) => plainCourses.set(courseId, { tenantId, hasContent }),
  };
}
