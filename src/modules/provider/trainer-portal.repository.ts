import { forTenant } from '../../config/database';
import type { TrainerCourseRow, TrainerPortalRepository, TrainerProfile, TrainerSessionRow, TrainerTraineeRow } from './trainer-portal.service';

const nameOf = (u: { fullName: string | null; email: string }) => u.fullName ?? u.email.split('@')[0] ?? u.email;

/** Everything is scoped by the academy (RLS) AND by the trainer's own id, so a trainer only ever reads their own courses. */
export class PrismaTrainerPortalRepository implements TrainerPortalRepository {
  findTrainerByUser(tenantId: string, userId: string): Promise<TrainerProfile | null> {
    return forTenant(tenantId).trainer.findFirst({ where: { tenantId, userId }, select: { id: true, fullName: true, specialization: true, bio: true } });
  }

  async listCourses(tenantId: string, trainerId: string): Promise<TrainerCourseRow[]> {
    const rows = await forTenant(tenantId).course.findMany({
      where: { tenantId, trainerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, type: true, isPublished: true, scheduleStartsAt: true, durationDays: true, _count: { select: { enrollments: true } } },
    });
    return rows.map((c) => ({ id: c.id, title: c.title, type: c.type, isPublished: c.isPublished, enrollmentCount: c._count.enrollments, startsAt: c.scheduleStartsAt, durationDays: c.durationDays }));
  }

  async listUpcomingSessions(tenantId: string, trainerId: string, from: Date, take: number): Promise<TrainerSessionRow[]> {
    const rows = await forTenant(tenantId).virtualClassroom.findMany({
      where: { tenantId, trainerId, status: 'SCHEDULED', startsAt: { gte: from } },
      orderBy: { startsAt: 'asc' },
      take,
      select: { id: true, title: true, startsAt: true, durationMinutes: true, provider: true, joinUrl: true, course: { select: { title: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.startsAt, durationMinutes: r.durationMinutes, provider: r.provider, joinUrl: r.joinUrl, courseTitle: r.course?.title ?? null }));
  }

  async ownsRecordedCourse(tenantId: string, trainerId: string, courseId: string): Promise<boolean> {
    return (await forTenant(tenantId).course.count({ where: { tenantId, id: courseId, trainerId, type: 'RECORDED' } })) > 0;
  }

  async listCourseTrainees(tenantId: string, trainerId: string, courseId: string): Promise<{ title: string; trainees: TrainerTraineeRow[] } | null> {
    const course = await forTenant(tenantId).course.findFirst({
      where: { tenantId, id: courseId, trainerId },
      select: {
        title: true,
        enrollments: {
          orderBy: { createdAt: 'asc' },
          select: { progressPercentage: true, completionStatus: true, status: true, createdAt: true, user: { select: { fullName: true, email: true } } },
        },
      },
    });
    if (!course) return null;
    return {
      title: course.title,
      trainees: course.enrollments.map((e) => ({
        name: nameOf(e.user),
        progress: e.progressPercentage.toNumber(),
        completionStatus: e.completionStatus,
        status: e.status,
        enrolledAt: e.createdAt,
      })),
    };
  }
}
