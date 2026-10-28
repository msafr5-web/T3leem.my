import type { Prisma, ClassroomStatus, CompletionStatus, ContentType, EnrollmentStatus, HlsStatus, MeetingProvider } from '@prisma/client';
import { forTenant, prisma, withTenantTransaction } from '../../../config/database';

export interface MyEnrollment {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  trainerName: string;
  status: EnrollmentStatus;
  completionStatus: CompletionStatus;
  progress: number;
  lessonCount: number;
  certificateCode: string | null;
  enrolledAt: Date;
}

export interface MyCourse {
  enrollmentId: string;
  courseTitle: string;
  progress: number;
  completionStatus: CompletionStatus;
  certificateCode: string | null;
  /** Recorded (YouTube) courses: the source video and the break/discussion minutes between segments. */
  youtubeVideoId: string | null;
  schedule: { breakMinutes: number; discussionMinutes: number } | null;
  modules: {
    id: string;
    title: string;
    lessons: {
      id: string;
      title: string;
      contentType: ContentType;
      mediaUrl: string | null;
      hlsStatus: HlsStatus;
      durationSeconds: number | null;
      startSecond: number | null;
      endSecond: number | null;
      completed: boolean;
    }[];
  }[];
}

const scheduleOf = (raw: Prisma.JsonValue | null): MyCourse['schedule'] => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { breakMinutes, discussionMinutes } = raw as Record<string, unknown>;
  return typeof breakMinutes === 'number' && typeof discussionMinutes === 'number' ? { breakMinutes, discussionMinutes } : null;
};

export type CompleteResult =
  | { kind: 'lesson_not_found' }
  | { kind: 'not_enrolled' }
  | { kind: 'ok'; progress: number; completed: boolean; certificateCode: string | null };

export interface MyClassroom {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  provider: MeetingProvider;
  joinUrl: string | null;
  status: ClassroomStatus;
  courseTitle: string | null;
}

export interface CertificateView {
  code: string;
  issuedAt: Date;
  learnerName: string;
  courseTitle: string;
  trainingHours: number | null;
  accreditationNumber: string | null;
  licenseNumber: string | null;
  trainerName: string;
  academyName: string;
  academySlug: string;
}

export interface LearningRepository {
  myEnrollments(tenantId: string, userId: string): Promise<MyEnrollment[]>;
  myCourse(tenantId: string, userId: string, courseId: string): Promise<MyCourse | null>;
  completeLesson(tenantId: string, userId: string, lessonId: string, issue: { code: () => string; verifyUrl: (code: string) => string }): Promise<CompleteResult>;
  myUpcomingClassrooms(tenantId: string, userId: string, now: Date): Promise<MyClassroom[]>;
  verifyCertificate(code: string): Promise<CertificateView | null>;
  listCertificates(tenantId: string): Promise<{ code: string; issuedAt: Date; learnerName: string; courseTitle: string }[]>;
}

const pct = (d: { toNumber(): number }) => d.toNumber();

/** Shows initials-free but privacy-aware names: full name if set, else the email's local part. */
const displayName = (u: { fullName: string | null; email: string }) => u.fullName ?? u.email.split('@')[0] ?? u.email;

export class PrismaLearningRepository implements LearningRepository {
  async myEnrollments(tenantId: string, userId: string): Promise<MyEnrollment[]> {
    const rows = await forTenant(tenantId).enrollment.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        completionStatus: true,
        progressPercentage: true,
        createdAt: true,
        certificates: { select: { certificateCode: true }, take: 1 },
        course: { select: { id: true, title: true, trainer: { select: { fullName: true } }, modules: { select: { _count: { select: { lessons: true } } } } } },
      },
    });
    return rows.map((e) => ({
      enrollmentId: e.id,
      courseId: e.course.id,
      courseTitle: e.course.title,
      trainerName: e.course.trainer.fullName,
      status: e.status,
      completionStatus: e.completionStatus,
      progress: pct(e.progressPercentage),
      lessonCount: e.course.modules.reduce((s, m) => s + m._count.lessons, 0),
      certificateCode: e.certificates[0]?.certificateCode ?? null,
      enrolledAt: e.createdAt,
    }));
  }

  async myCourse(tenantId: string, userId: string, courseId: string): Promise<MyCourse | null> {
    const e = await forTenant(tenantId).enrollment.findUnique({
      where: { tenantId_userId_courseId: { tenantId, userId, courseId } },
      select: {
        id: true,
        status: true,
        completionStatus: true,
        progressPercentage: true,
        progress: { select: { lessonId: true } },
        certificates: { select: { certificateCode: true }, take: 1 },
        course: {
          select: {
            title: true,
            sourceVideoId: true,
            scheduleConfig: true,
            modules: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                title: true,
                lessons: {
                  orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
                  // mediaUrl only for non-video lessons (PDF links); video goes through signed HLS.
                  select: { id: true, title: true, contentType: true, mediaUrl: true, hlsStatus: true, durationSeconds: true, startSecond: true, endSecond: true },
                },
              },
            },
          },
        },
      },
    });
    if (!e || e.status !== 'ACTIVE') return null;
    const done = new Set(e.progress.map((p) => p.lessonId));
    return {
      enrollmentId: e.id,
      courseTitle: e.course.title,
      progress: pct(e.progressPercentage),
      completionStatus: e.completionStatus,
      certificateCode: e.certificates[0]?.certificateCode ?? null,
      youtubeVideoId: e.course.sourceVideoId,
      schedule: e.course.sourceVideoId ? scheduleOf(e.course.scheduleConfig) : null,
      modules: e.course.modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map((l) => ({ ...l, mediaUrl: l.contentType === 'VIDEO' ? null : l.mediaUrl, completed: done.has(l.id) })),
      })),
    };
  }

  completeLesson(tenantId: string, userId: string, lessonId: string, issue: { code: () => string; verifyUrl: (code: string) => string }): Promise<CompleteResult> {
    return withTenantTransaction(tenantId, async (tx) => {
      const lesson = await tx.lesson.findFirst({ where: { tenantId, id: lessonId }, select: { module: { select: { courseId: true } } } });
      if (!lesson) return { kind: 'lesson_not_found' } as const;
      const courseId = lesson.module.courseId;

      const enrollment = await tx.enrollment.findUnique({
        where: { tenantId_userId_courseId: { tenantId, userId, courseId } },
        select: { id: true, status: true },
      });
      if (!enrollment || enrollment.status !== 'ACTIVE') return { kind: 'not_enrolled' } as const;

      await tx.lessonProgress.upsert({
        where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
        create: { tenantId, enrollmentId: enrollment.id, lessonId },
        update: {},
      });

      const [total, done] = await Promise.all([
        tx.lesson.count({ where: { tenantId, module: { courseId } } }),
        tx.lessonProgress.count({ where: { tenantId, enrollmentId: enrollment.id } }),
      ]);
      const progress = total ? Math.min(100, Math.round((done * 10000) / total) / 100) : 0;
      const completed = total > 0 && done >= total;

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { progressPercentage: progress, completionStatus: completed ? 'COMPLETED' : 'ENROLLED' },
      });

      // Course finished: issue the certificate in the SAME transaction — never a completed
      // enrollment without its certificate, never a certificate for an unfinished course.
      let certificateCode: string | null = null;
      if (completed) {
        const existing = await tx.certificate.findUnique({ where: { enrollmentId: enrollment.id }, select: { certificateCode: true } });
        if (existing) {
          certificateCode = existing.certificateCode;
        } else {
          const code = issue.code();
          const cert = await tx.certificate.create({
            data: { tenantId, enrollmentId: enrollment.id, certificateCode: code, qrCodeUrl: issue.verifyUrl(code) },
            select: { id: true },
          });
          await tx.certificateRegistry.create({ data: { code, tenantId, certificateId: cert.id } });
          certificateCode = code;
        }
      }
      return { kind: 'ok', progress, completed, certificateCode } as const;
    });
  }

  async myUpcomingClassrooms(tenantId: string, userId: string, now: Date): Promise<MyClassroom[]> {
    const rows = await forTenant(tenantId).virtualClassroom.findMany({
      where: {
        tenantId,
        status: 'SCHEDULED',
        // Still joinable until it ends.
        startsAt: { gte: new Date(now.getTime() - 12 * 3600_000) },
        course: { enrollments: { some: { userId, status: 'ACTIVE' } } },
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
      select: { id: true, title: true, startsAt: true, durationMinutes: true, provider: true, joinUrl: true, status: true, course: { select: { title: true } } },
    });
    return rows
      .filter((r) => r.startsAt.getTime() + r.durationMinutes * 60_000 > now.getTime())
      .map((r) => ({ ...r, courseTitle: r.course?.title ?? null }));
  }

  async verifyCertificate(code: string): Promise<CertificateView | null> {
    // Registry first (no RLS): which academy issued this code?
    const entry = await prisma.certificateRegistry.findUnique({ where: { code } });
    if (!entry) return null;
    const tenant = await prisma.tenant.findUnique({ where: { id: entry.tenantId }, select: { name: true, slug: true } });
    if (!tenant) return null;
    // Then read the certificate itself under that academy's RLS context.
    const cert = await withTenantTransaction(entry.tenantId, (tx) =>
      tx.certificate.findUnique({
        where: { id: entry.certificateId },
        select: {
          certificateCode: true,
          issuedAt: true,
          enrollment: {
            select: {
              user: { select: { fullName: true, email: true } },
              course: { select: { title: true, trainingHours: true, accreditationNumber: true, licenseNumber: true, trainer: { select: { fullName: true } } } },
            },
          },
        },
      }),
    );
    if (!cert) return null;
    return {
      code: cert.certificateCode,
      issuedAt: cert.issuedAt,
      learnerName: displayName(cert.enrollment.user),
      courseTitle: cert.enrollment.course.title,
      trainingHours: cert.enrollment.course.trainingHours?.toNumber() ?? null,
      accreditationNumber: cert.enrollment.course.accreditationNumber,
      licenseNumber: cert.enrollment.course.licenseNumber,
      trainerName: cert.enrollment.course.trainer.fullName,
      academyName: tenant.name,
      academySlug: tenant.slug,
    };
  }

  async listCertificates(tenantId: string): Promise<{ code: string; issuedAt: Date; learnerName: string; courseTitle: string }[]> {
    const rows = await forTenant(tenantId).certificate.findMany({
      where: { tenantId },
      orderBy: { issuedAt: 'desc' },
      select: { certificateCode: true, issuedAt: true, enrollment: { select: { user: { select: { fullName: true, email: true } }, course: { select: { title: true } } } } },
    });
    return rows.map((r) => ({ code: r.certificateCode, issuedAt: r.issuedAt, learnerName: displayName(r.enrollment.user), courseTitle: r.enrollment.course.title }));
  }
}
