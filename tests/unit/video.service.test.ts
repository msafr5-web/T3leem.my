import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { MediaLesson, MediaRepository } from '../../src/modules/lms/media/media.repository';
import { VideoService, type MediaToken, type VideoJob } from '../../src/modules/lms/media/video.service';
import { LocalFileStorage } from '../../src/shared/services/storage';
import { FieldCipher, HmacTokens } from '../../src/shared/utils/crypto';

const T = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const U = 'user-1';
const L = 'e2000000-0000-4000-8000-000000000001';
const C = 'course-1';
const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function setup(lesson: Partial<MediaLesson> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 't3leem-video-'));
  const storage = new LocalFileStorage(dir);
  const cipher = new FieldCipher(randomBytes(32).toString('base64'));
  const tokens = new HmacTokens<MediaToken>('signing-secret-signing-secret-signing-secret');
  let current: MediaLesson | null = { id: L, courseId: C, contentType: 'VIDEO', hlsStatus: 'READY', hlsKeyEncrypted: null, ...lesson };
  let enrolled = true;
  const jobs: VideoJob[] = [];
  const repo = {
    getLesson: jest.fn(async () => current),
    setHls: jest.fn(async (_t: string, _l: string, data: { hlsStatus: MediaLesson['hlsStatus']; hlsKeyEncrypted?: string | null }) => {
      if (current) current = { ...current, hlsStatus: data.hlsStatus, hlsKeyEncrypted: data.hlsKeyEncrypted ?? current.hlsKeyEncrypted };
    }),
    hasActiveEnrollment: jest.fn(async () => enrolled),
    createRecordingLesson: jest.fn(async () => 'rec-lesson'),
    getClassroomCourse: jest.fn(async () => ({ courseId: C as string | null, title: 'Live' })),
  } as unknown as jest.Mocked<MediaRepository>;
  const transcoder = { toEncryptedHls: jest.fn(async () => ({ durationSeconds: 42 })) };
  let now = 1_800_000_000_000;
  const service = new VideoService({
    repository: repo,
    storage,
    transcoder,
    cipher,
    tokens,
    queue: { enqueue: async (j) => void jobs.push(j) },
    maxUploadBytes: 1024,
    now: () => now,
    fetchImpl: (async () => new Response(Readable.toWeb(Readable.from([MP4_HEAD])) as never, { status: 200 })) as unknown as typeof fetch,
  });
  return {
    service, repo, storage, dir, cipher, transcoder, jobs,
    setLesson: (l: MediaLesson | null) => (current = l),
    setEnrolled: (v: boolean) => (enrolled = v),
    advance: (ms: number) => (now += ms),
    tokenFrom: (path_: string) => decodeURIComponent(path_.split('token=')[1] ?? ''),
  };
}

describe('VideoService upload', () => {
  it('stores a real video, marks it PROCESSING and queues a transcode', async () => {
    const { service, dir, repo, jobs } = setup();
    await service.acceptUpload(T, L, Readable.from([MP4_HEAD, Buffer.alloc(100)]), 112);
    expect(readFileSync(path.join(dir, 'sources', T, L)).length).toBe(112);
    expect(repo.setHls).toHaveBeenCalledWith(T, L, { hlsStatus: 'PROCESSING', hlsError: null });
    expect(jobs).toEqual([{ kind: 'transcode', tenantId: T, lessonId: L }]);
  });

  it('rejects non-video bytes (even with a video content type) and leaves nothing on disk', async () => {
    const { service, dir } = setup();
    await expect(service.acceptUpload(T, L, Readable.from([Buffer.from('<html><script>alert(1)</script>')]), null)).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO' });
    expect(existsSync(path.join(dir, 'sources', T, L))).toBe(false);
  });

  it('regression: a rejected re-upload never deletes the previous good source (queued transcode still works)', async () => {
    const { service, dir } = setup();
    await service.acceptUpload(T, L, Readable.from([MP4_HEAD, Buffer.alloc(100)]), 112);
    await expect(service.acceptUpload(T, L, Readable.from([Buffer.from('<html>bad</html>')]), null)).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO' });
    expect(readFileSync(path.join(dir, 'sources', T, L)).length).toBe(112);
    // No temp files left behind either.
    expect(require('node:fs').readdirSync(path.join(dir, 'sources', T))).toEqual([L]);
  });

  it('rejects oversize uploads by declared length and while streaming', async () => {
    const { service, dir } = setup();
    await expect(service.acceptUpload(T, L, Readable.from([MP4_HEAD]), 10_000)).rejects.toMatchObject({ status: 413 });
    await expect(service.acceptUpload(T, L, Readable.from([MP4_HEAD, Buffer.alloc(2000)]), null)).rejects.toMatchObject({ status: 413 });
    expect(existsSync(path.join(dir, 'sources', T, L))).toBe(false);
  });

  it('only video lessons accept uploads; unknown lessons 404', async () => {
    const pdf = setup({ contentType: 'PDF' });
    await expect(pdf.service.acceptUpload(T, L, Readable.from([MP4_HEAD]), null)).rejects.toMatchObject({ code: 'NOT_A_VIDEO_LESSON' });
    const none = setup();
    none.setLesson(null);
    await expect(none.service.acceptUpload(T, L, Readable.from([MP4_HEAD]), null)).rejects.toMatchObject({ status: 404 });
  });
});

describe('VideoService transcode jobs', () => {
  it('stores the content key sealed (never in clear) and marks READY', async () => {
    const { service, repo, cipher } = setup({ hlsStatus: 'PROCESSING' });
    await service.process({ kind: 'transcode', tenantId: T, lessonId: L });
    const call = repo.setHls.mock.calls.at(-1)![2] as { hlsStatus: string; hlsKeyEncrypted: string; durationSeconds: number };
    expect(call.hlsStatus).toBe('READY');
    expect(call.durationSeconds).toBe(42);
    expect(call.hlsKeyEncrypted.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(call.hlsKeyEncrypted)).toHaveLength(16);
  });

  it('marks FAILED with the error when ffmpeg fails', async () => {
    const { service, repo, transcoder } = setup();
    transcoder.toEncryptedHls.mockRejectedValueOnce(new Error('ffmpeg exited with 1: bad input'));
    await service.transcode(T, L);
    expect(repo.setHls).toHaveBeenLastCalledWith(T, L, { hlsStatus: 'FAILED', hlsError: 'ffmpeg exited with 1: bad input' });
  });

  it('imports a Zoom recording into the course as a new protected lesson', async () => {
    const { service, repo, transcoder } = setup();
    await service.process({ kind: 'import-recording', tenantId: T, classroomId: 'cls', downloadUrl: 'https://zoom.us/rec/1', downloadToken: 'dl', topic: 'Session 1' });
    expect(repo.createRecordingLesson).toHaveBeenCalledWith(T, C, 'تسجيل: Session 1');
    expect(transcoder.toEncryptedHls).toHaveBeenCalled();
  });

  it('skips recordings of classrooms without a course', async () => {
    const { service, repo } = setup();
    repo.getClassroomCourse.mockResolvedValueOnce({ courseId: null, title: 'x' });
    await service.process({ kind: 'import-recording', tenantId: T, classroomId: 'cls', downloadUrl: 'https://zoom.us/rec/1', downloadToken: null, topic: '' });
    expect(repo.createRecordingLesson).not.toHaveBeenCalled();
  });
});

describe('VideoService playback', () => {
  const ready = () => {
    const ctx = setup();
    const sealed = ctx.cipher.encrypt(Buffer.alloc(16, 7));
    ctx.setLesson({ id: L, courseId: C, contentType: 'VIDEO', hlsStatus: 'READY', hlsKeyEncrypted: sealed });
    return ctx;
  };

  it('issues a token only to enrolled learners, and only for READY videos', async () => {
    const { service, setEnrolled, setLesson } = ready();
    const p = await service.issuePlayback(T, U, L);
    expect(p.playlistPath).toMatch(new RegExp(`^/media/lessons/${L}/playlist\\.m3u8\\?token=`));
    setEnrolled(false);
    await expect(service.issuePlayback(T, U, L)).rejects.toMatchObject({ status: 403 });
    setEnrolled(true);
    setLesson({ id: L, courseId: C, contentType: 'VIDEO', hlsStatus: 'PROCESSING', hlsKeyEncrypted: null });
    await expect(service.issuePlayback(T, U, L)).rejects.toMatchObject({ code: 'VIDEO_NOT_READY' });
    setLesson(null);
    await expect(service.issuePlayback(T, U, L)).rejects.toMatchObject({ status: 404 });
  });

  it('serves the key after a LIVE enrollment re-check; revoking access stops it immediately', async () => {
    const { service, tokenFrom, setEnrolled } = ready();
    const token = tokenFrom((await service.issuePlayback(T, U, L)).playlistPath);
    await expect(service.key(T, L, token)).resolves.toEqual(Buffer.alloc(16, 7));
    setEnrolled(false);
    await expect(service.key(T, L, token)).rejects.toMatchObject({ status: 403 });
  });

  it('tokens are bound to tenant + lesson and expire', async () => {
    const { service, tokenFrom, advance } = ready();
    const token = tokenFrom((await service.issuePlayback(T, U, L)).playlistPath);
    await expect(service.key('other-tenant', L, token)).rejects.toMatchObject({ status: 403 });
    await expect(service.key(T, 'other-lesson', token)).rejects.toMatchObject({ status: 403 });
    advance(3 * 3600_000);
    await expect(service.key(T, L, token)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects path-traversal segment names', async () => {
    const { service, tokenFrom } = ready();
    const token = tokenFrom((await service.issuePlayback(T, U, L)).playlistPath);
    expect(() => service.segment(T, L, token, '../../../.env')).toThrow();
    expect(() => service.segment(T, L, token, 'seg_0000.ts.exe')).toThrow();
  });

  it('playlist 404s when the files are missing; removeLessonMedia never throws', async () => {
    const { service, tokenFrom } = ready();
    const token = tokenFrom((await service.issuePlayback(T, U, L)).playlistPath);
    await expect(service.playlist(T, L, token)).rejects.toMatchObject({ status: 404 });
    await expect(service.removeLessonMedia(T, L)).resolves.toBeUndefined();
  });
});

describe('LocalFileStorage', () => {
  it('refuses keys that escape the storage root', () => {
    const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 't3leem-st-')));
    expect(() => storage.localPath('../etc/passwd')).toThrow();
    expect(() => storage.localPath('a/../../b')).toThrow();
    expect(() => storage.localPath('/abs/path')).toThrow();
    expect(storage.localPath('hls/t/l/seg_0001.ts')).toContain(path.join('hls', 't', 'l'));
  });

  it('reports size and null for missing files', async () => {
    const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 't3leem-st-')));
    await storage.writeFile('a/b.txt', 'hello');
    await expect(storage.size('a/b.txt')).resolves.toBe(5);
    await expect(storage.size('a/missing')).resolves.toBeNull();
  });
});
