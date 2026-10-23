import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { logger } from '../../../shared/services/logger';
import type { FileStorage } from '../../../shared/services/storage';
import type { FieldCipher, HmacTokens } from '../../../shared/utils/crypto';
import { HttpError } from '../../../shared/utils/http-error';
import type { MediaRepository } from './media.repository';
import { signPlaylist, type Transcoder } from './transcoder';

export interface MediaToken {
  /** tenant */ t: string;
  /** user */ u: string;
  /** lesson */ l: string;
  exp: number;
}

export type VideoJob =
  | { kind: 'transcode'; tenantId: string; lessonId: string }
  | { kind: 'import-recording'; tenantId: string; classroomId: string; downloadUrl: string; downloadToken: string | null; topic: string };

export interface VideoQueue {
  enqueue(job: VideoJob): Promise<void>;
}

export interface VideoServiceDeps {
  repository: MediaRepository;
  storage: FileStorage;
  transcoder: Transcoder;
  cipher: FieldCipher;
  tokens: HmacTokens<MediaToken>;
  queue: VideoQueue;
  maxUploadBytes: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const PLAYBACK_TTL_SECONDS = 2 * 60 * 60;
const SEGMENT_RE = /^seg_\d{4,5}\.ts$/;

const sourceKey = (tenantId: string, lessonId: string) => `sources/${tenantId}/${lessonId}`;
const hlsPrefix = (tenantId: string, lessonId: string) => `hls/${tenantId}/${lessonId}`;

/** Recognizes MP4/MOV (ftyp box), WebM/MKV (EBML) from the first bytes of the upload. */
export function looksLikeVideo(head: Buffer): boolean {
  if (head.length >= 8 && head.toString('ascii', 4, 8) === 'ftyp') return true;
  return head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3;
}

/**
 * Protected video (SWET §5): upload -> background AES-128 HLS transcode -> short-lived signed
 * playback URLs for enrolled learners only. The content key is stored sealed with AES-256-GCM
 * and handed out per request after a live enrollment re-check, so revoking an enrollment
 * stops playback within the current segment, not when a token happens to expire.
 */
export class VideoService {
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: VideoServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  // ----- admin upload -----

  async acceptUpload(tenantId: string, lessonId: string, body: Readable, declaredBytes: number | null): Promise<void> {
    const lesson = await this.deps.repository.getLesson(tenantId, lessonId);
    if (!lesson) throw HttpError.notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (lesson.contentType !== 'VIDEO') throw HttpError.unprocessable('NOT_A_VIDEO_LESSON', 'Videos can only be uploaded to video lessons');
    if (declaredBytes !== null && declaredBytes > this.deps.maxUploadBytes) {
      throw new HttpError(413, 'VIDEO_TOO_LARGE', 'The video exceeds the maximum upload size');
    }

    // Write to a private temp key, then publish with an atomic rename. A rejected or aborted
    // upload only ever deletes its OWN temp file — never the good source a queued transcode
    // is about to read (found by the e2e test: a bad re-upload used to delete it).
    const tempKey = `${sourceKey(tenantId, lessonId)}.upload-${randomBytes(6).toString('hex')}`;
    try {
      await this.deps.storage.writeStream(tempKey, this.guardUpload(body));
      await this.deps.storage.move(tempKey, sourceKey(tenantId, lessonId));
    } catch (err) {
      await this.deps.storage.removePrefix(tempKey).catch(() => undefined);
      throw err;
    }
    await this.deps.repository.setHls(tenantId, lessonId, { hlsStatus: 'PROCESSING', hlsError: null });
    await this.deps.queue.enqueue({ kind: 'transcode', tenantId, lessonId });
  }

  /**
   * Pass-through that rejects non-video content (first bytes) and oversize bodies (running count).
   * A Transform (not a 'data' listener) so nothing flows — and nothing is lost — until it's piped.
   */
  private guardUpload(body: Readable): Readable {
    let seen = 0;
    let checked = false;
    const max = this.deps.maxUploadBytes;
    const guard = new Transform({
      transform(chunk: Buffer, _enc, done) {
        seen += chunk.length;
        if (!checked) {
          checked = true;
          if (!looksLikeVideo(chunk)) return done(HttpError.unprocessable('UNSUPPORTED_VIDEO', 'Upload an MP4, MOV, WebM or MKV video'));
        }
        if (seen > max) return done(new HttpError(413, 'VIDEO_TOO_LARGE', 'The video exceeds the maximum upload size'));
        done(null, chunk);
      },
    });
    body.on('error', (err) => guard.destroy(err));
    return body.pipe(guard);
  }

  // ----- background jobs -----

  async process(job: VideoJob): Promise<void> {
    if (job.kind === 'transcode') return this.transcode(job.tenantId, job.lessonId);
    return this.importRecording(job);
  }

  async transcode(tenantId: string, lessonId: string): Promise<void> {
    const key = randomBytes(16);
    try {
      const { durationSeconds } = await this.deps.transcoder.toEncryptedHls({
        sourcePath: this.deps.storage.localPath(sourceKey(tenantId, lessonId)),
        outDir: this.deps.storage.localPath(hlsPrefix(tenantId, lessonId)),
        key,
      });
      await this.deps.repository.setHls(tenantId, lessonId, {
        hlsStatus: 'READY',
        hlsKeyEncrypted: this.deps.cipher.encrypt(key),
        hlsError: null,
        durationSeconds,
      });
      logger.info('Video transcoded to encrypted HLS', { tenantId, lessonId, durationSeconds });
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
      logger.error('Video transcode failed', { tenantId, lessonId, err: message });
      await this.deps.repository.setHls(tenantId, lessonId, { hlsStatus: 'FAILED', hlsError: message });
    } finally {
      key.fill(0);
    }
  }

  /** Zoom recording.completed -> download the MP4 into the course as a protected video lesson. */
  private async importRecording(job: Extract<VideoJob, { kind: 'import-recording' }>): Promise<void> {
    const classroom = await this.deps.repository.getClassroomCourse(job.tenantId, job.classroomId);
    if (!classroom?.courseId) {
      logger.info('Recording ignored: classroom has no course', { classroomId: job.classroomId });
      return;
    }
    const lessonId = await this.deps.repository.createRecordingLesson(job.tenantId, classroom.courseId, `تسجيل: ${job.topic || classroom.title}`);
    const res = await this.fetchImpl(job.downloadUrl, {
      headers: job.downloadToken ? { Authorization: `Bearer ${job.downloadToken}` } : {},
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!res.ok || !res.body) {
      await this.deps.repository.setHls(job.tenantId, lessonId, { hlsStatus: 'FAILED', hlsError: `Recording download failed (HTTP ${res.status})` });
      return;
    }
    await this.deps.storage.writeStream(sourceKey(job.tenantId, lessonId), Readable.fromWeb(res.body as never));
    await this.transcode(job.tenantId, lessonId);
  }

  // ----- playback -----

  async issuePlayback(tenantId: string, userId: string, lessonId: string): Promise<{ playlistPath: string; expiresIn: number }> {
    const lesson = await this.deps.repository.getLesson(tenantId, lessonId);
    if (!lesson || lesson.contentType !== 'VIDEO') throw HttpError.notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (!(await this.deps.repository.hasActiveEnrollment(tenantId, userId, lesson.courseId))) {
      throw HttpError.forbidden('Enroll in this course to watch its videos');
    }
    if (lesson.hlsStatus !== 'READY') throw HttpError.conflict('VIDEO_NOT_READY', 'This video is still being processed');

    const token = this.deps.tokens.sign({ t: tenantId, u: userId, l: lessonId, exp: Math.floor(this.now() / 1000) + PLAYBACK_TTL_SECONDS });
    return { playlistPath: `/media/lessons/${lessonId}/playlist.m3u8?token=${encodeURIComponent(token)}`, expiresIn: PLAYBACK_TTL_SECONDS };
  }

  async playlist(tenantId: string, lessonId: string, token: string): Promise<string> {
    this.verify(tenantId, lessonId, token);
    const raw = await this.deps.storage.readFile(`${hlsPrefix(tenantId, lessonId)}/playlist.m3u8`).catch(() => null);
    if (!raw) throw HttpError.notFound('VIDEO_NOT_FOUND', 'Video not found');
    return signPlaylist(raw.toString('utf8'), token);
  }

  async key(tenantId: string, lessonId: string, token: string): Promise<Buffer> {
    const claims = this.verify(tenantId, lessonId, token);
    const lesson = await this.deps.repository.getLesson(tenantId, lessonId);
    if (!lesson?.hlsKeyEncrypted) throw HttpError.notFound('VIDEO_NOT_FOUND', 'Video not found');
    // Live re-check (SWET §5 "Verify User Active Enrollment"): a revoked enrollment loses the key now.
    if (!(await this.deps.repository.hasActiveEnrollment(tenantId, claims.u, lesson.courseId))) throw HttpError.forbidden('Access denied');
    return this.deps.cipher.decrypt(lesson.hlsKeyEncrypted);
  }

  segment(tenantId: string, lessonId: string, token: string, name: string): Readable {
    this.verify(tenantId, lessonId, token);
    if (!SEGMENT_RE.test(name)) throw HttpError.notFound('SEGMENT_NOT_FOUND', 'Segment not found');
    return this.deps.storage.createReadStream(`${hlsPrefix(tenantId, lessonId)}/${name}`);
  }

  async removeLessonMedia(tenantId: string, lessonId: string): Promise<void> {
    await Promise.all([
      this.deps.storage.removePrefix(sourceKey(tenantId, lessonId)),
      this.deps.storage.removePrefix(hlsPrefix(tenantId, lessonId)),
    ]).catch(() => undefined);
  }

  private verify(tenantId: string, lessonId: string, token: string): MediaToken {
    const claims = this.deps.tokens.verify(token, Math.floor(this.now() / 1000));
    // Token is bound to tenant + lesson: it can't be replayed against another video or academy.
    if (!claims || claims.t !== tenantId || claims.l !== lessonId) throw HttpError.forbidden('Invalid or expired media link');
    return claims;
  }
}
