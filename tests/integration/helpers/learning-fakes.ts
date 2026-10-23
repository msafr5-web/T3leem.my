/**
 * Fakes for the learner journey (content, progress, certificates, protected video, Zoom
 * webhooks, custom domains). Services are REAL; only storage-backed repositories are in memory,
 * and the video store is a real temp directory with real AES-sealed keys and signed tokens.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ZoomWebhookService, type ParticipantJoined, type RecordingImportJob } from '../../../src/modules/live/zoom-webhook.service';
import { ContentService } from '../../../src/modules/lms/content/content.service';
import type { ContentModule, ContentRepository } from '../../../src/modules/lms/content/content.repository';
import type { CertificateView, LearningRepository } from '../../../src/modules/lms/learning/learning.repository';
import { LearningService } from '../../../src/modules/lms/learning/learning.service';
import type { MediaLesson, MediaRepository } from '../../../src/modules/lms/media/media.repository';
import { VideoService, type MediaToken, type VideoJob } from '../../../src/modules/lms/media/video.service';
import { DomainService, type DomainRecord, type DomainRepository } from '../../../src/modules/tenant/domain.service';
import { LocalFileStorage } from '../../../src/shared/services/storage';
import { FieldCipher, HmacTokens } from '../../../src/shared/utils/crypto';

export const VIDEO_LESSON = 'e2000000-0000-4000-8000-000000000001';
export const PDF_LESSON = 'e2000000-0000-4000-8000-000000000002';
export const ZOOM_SECRET = 'zoom-webhook-secret-for-tests';
export const ZOOM_MEETING = '987654321';
export const CONTENT_KEY = randomBytes(16);

export function buildLearningFakes(ids: { tenantA: string; user: string; course: string; classroom: string }) {
  const { tenantA, user, course, classroom } = ids;

  // ----- video: real storage dir with a "transcoded" lesson -----
  const storageDir = mkdtempSync(path.join(tmpdir(), 't3leem-media-'));
  const hlsDir = path.join(storageDir, 'hls', tenantA, VIDEO_LESSON);
  mkdirSync(hlsDir, { recursive: true });
  writeFileSync(
    path.join(hlsDir, 'playlist.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6.0,\nseg_0000.ts\n#EXTINF:4.5,\nseg_0001.ts\n#EXT-X-ENDLIST\n',
  );
  writeFileSync(path.join(hlsDir, 'seg_0000.ts'), Buffer.from('ENCRYPTED-SEGMENT-0'));

  const cipher = new FieldCipher(randomBytes(32).toString('base64'));
  const tokens = new HmacTokens<MediaToken>('media-signing-secret-for-tests-0123456789');
  const lessons = new Map<string, MediaLesson>([
    [VIDEO_LESSON, { id: VIDEO_LESSON, courseId: course, contentType: 'VIDEO', hlsStatus: 'READY', hlsKeyEncrypted: cipher.encrypt(CONTENT_KEY) }],
    [PDF_LESSON, { id: PDF_LESSON, courseId: course, contentType: 'PDF', hlsStatus: 'NONE', hlsKeyEncrypted: null }],
  ]);
  const activeEnrollments = new Set([`${tenantA}:${user}:${course}`]);
  const videoJobs: VideoJob[] = [];

  const mediaRepo: MediaRepository = {
    getLesson: async (t, id) => (t === tenantA ? (lessons.get(id) ?? null) : null),
    setHls: async (_t, id, data) => {
      const l = lessons.get(id);
      if (l) lessons.set(id, { ...l, hlsStatus: data.hlsStatus, hlsKeyEncrypted: data.hlsKeyEncrypted ?? l.hlsKeyEncrypted });
    },
    hasActiveEnrollment: async (t, u, c) => activeEnrollments.has(`${t}:${u}:${c}`),
    createRecordingLesson: async () => 'rec-lesson',
    getClassroomCourse: async () => ({ courseId: course, title: 'Live' }),
  };
  const video = new VideoService({
    repository: mediaRepo,
    storage: new LocalFileStorage(storageDir),
    transcoder: { toEncryptedHls: async () => ({ durationSeconds: 10 }) },
    cipher,
    tokens,
    queue: { enqueue: async (job) => void videoJobs.push(job) },
    maxUploadBytes: 64 * 1024,
  });

  // ----- learning: two lessons; completing both issues a certificate -----
  const completed = new Set<string>();
  const certificates = new Map<string, CertificateView>();
  const learningRepo: LearningRepository = {
    myEnrollments: async (t, u) =>
      t === tenantA && u === user
        ? [{ enrollmentId: 'enr-1', courseId: course, courseTitle: 'PMP', trainerName: 'Khalid', status: 'ACTIVE', completionStatus: 'ENROLLED', progress: (completed.size / 2) * 100, lessonCount: 2, certificateCode: [...certificates.keys()][0] ?? null, enrolledAt: new Date('2026-10-01T00:00:00Z') }]
        : [],
    myCourse: async (t, u, c) =>
      t === tenantA && u === user && c === course
        ? {
            enrollmentId: 'enr-1',
            courseTitle: 'PMP',
            progress: (completed.size / 2) * 100,
            completionStatus: completed.size === 2 ? 'COMPLETED' : 'ENROLLED',
            certificateCode: [...certificates.keys()][0] ?? null,
            modules: [
              {
                id: 'm1',
                title: 'Basics',
                lessons: [
                  { id: VIDEO_LESSON, title: 'Intro video', contentType: 'VIDEO', mediaUrl: null, hlsStatus: lessons.get(VIDEO_LESSON)!.hlsStatus, durationSeconds: 10, completed: completed.has(VIDEO_LESSON) },
                  { id: PDF_LESSON, title: 'Guide', contentType: 'PDF', mediaUrl: 'https://example.com/guide.pdf', hlsStatus: 'NONE', durationSeconds: null, completed: completed.has(PDF_LESSON) },
                ],
              },
            ],
          }
        : null,
    completeLesson: async (t, u, lessonId, issue) => {
      if (!lessons.has(lessonId) || t !== tenantA) return { kind: 'lesson_not_found' };
      if (u !== user) return { kind: 'not_enrolled' };
      completed.add(lessonId);
      const done = completed.size === 2;
      let code: string | null = [...certificates.keys()][0] ?? null;
      if (done && !code) {
        code = issue.code();
        certificates.set(code, {
          code,
          issuedAt: new Date('2026-10-24T09:00:00Z'),
          learnerName: 'Abdullah',
          courseTitle: 'PMP',
          trainingHours: 35,
          accreditationNumber: 'DEMO-ACC-1',
          licenseNumber: 'DEMO-LIC-1',
          trainerName: 'Khalid',
          academyName: 'Rukn',
          academySlug: 'rukn',
        });
      }
      return { kind: 'ok', progress: (completed.size / 2) * 100, completed: done, certificateCode: done ? code : null };
    },
    myUpcomingClassrooms: async (t, u) =>
      t === tenantA && u === user
        ? [{ id: classroom, title: 'Live Q&A', startsAt: new Date('2030-01-01T15:00:00Z'), durationMinutes: 60, provider: 'ZOOM', joinUrl: 'https://zoom.us/j/1', status: 'SCHEDULED', courseTitle: 'PMP' }]
        : [],
    verifyCertificate: async (code) => certificates.get(code) ?? null,
    listCertificates: async (t) => (t === tenantA ? [...certificates.values()].map((c) => ({ code: c.code, issuedAt: c.issuedAt, learnerName: c.learnerName, courseTitle: c.courseTitle })) : []),
  };
  const learning = new LearningService({ repository: learningRepo, publicWebUrl: 'https://t3leem.my' });

  // ----- content -----
  const modules: ContentModule[] = [{ id: 'd3000000-0000-4000-8000-000000000001', title: 'Basics', sortOrder: 0, lessons: [] }];
  const removedMedia: string[] = [];
  const contentRepo: ContentRepository = {
    getCourseContent: async (t, c) => (t === tenantA && c === course ? modules : null),
    createModule: async (t, _a, c, title) => (t === tenantA && c === course ? (modules.push({ id: 'new-mod', title, sortOrder: 1, lessons: [] }), 'new-mod') : null),
    updateModule: async (t, _a, id) => t === tenantA && modules.some((m) => m.id === id),
    deleteModule: async (t, _a, id) => (t === tenantA && modules.some((m) => m.id === id) ? [VIDEO_LESSON] : null),
    createLesson: async (t, _a, moduleId) => (t === tenantA && modules.some((m) => m.id === moduleId) ? 'new-lesson' : null),
    updateLesson: async (t, _a, id) => t === tenantA && lessons.has(id),
    deleteLesson: async (t, _a, id) => t === tenantA && lessons.has(id),
  };
  const content = new ContentService({ repository: contentRepo, removeLessonMedia: async (_t, id) => void removedMedia.push(id) });

  // ----- Zoom webhooks -----
  const attendance: ParticipantJoined[] = [];
  const recordings: RecordingImportJob[] = [];
  const zoom = new ZoomWebhookService({
    secretToken: ZOOM_SECRET,
    repository: {
      findMeeting: async (id) => (id === ZOOM_MEETING ? { tenantId: tenantA, classroomId: classroom } : null),
      recordAttendance: async (_t, _c, p) => void attendance.push(p),
    },
    enqueueRecording: async (job) => void recordings.push(job),
  });

  // ----- custom domains -----
  const domainState: DomainRecord = { domain: null, token: null, verifiedAt: null };
  const domainRepo: DomainRepository = {
    getDomain: async (t) => (t === tenantA ? { ...domainState } : null),
    setDomain: async (_t, _a, domain, token) => {
      if (domain === 'taken.example.com') throw Object.assign(new Error('dup'), { code: 'P2002' });
      Object.assign(domainState, { domain, token, verifiedAt: null });
    },
    markDomainVerified: async () => {
      domainState.verifiedAt = new Date();
    },
    findSlugByVerifiedDomain: async (host) => (domainState.verifiedAt && host === domainState.domain ? 'rukn' : null),
  };
  const domains = new DomainService(
    domainRepo,
    't3leem.my',
    async (name) => (name === `_t3leem-challenge.${domainState.domain}` && domainState.domain === 'academy.example.com' ? [['t3leem-verify=', domainState.token ?? '']] : []),
    async () => undefined,
  );

  return { video, learning, content, zoom, domains, state: { lessons, activeEnrollments, videoJobs, completed, certificates, attendance, recordings, removedMedia, domainState, tokens } };
}
