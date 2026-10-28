import { Prisma, type UserRole } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';
import type { ScheduleConfig } from './schedule-planner';

export interface NewRecordedCourse {
  title: string;
  description: string | null;
  trainerId: string;
  price: string;
  isPublished: boolean;
  videoId: string;
  durationSeconds: number;
  config: ScheduleConfig;
  trainingHours: number;
  days: { title: string; lessons: { title: string; startSecond: number; endSecond: number }[] }[];
}

export interface RecordedCourseSummary {
  id: string;
  title: string;
  isPublished: boolean;
  videoId: string;
  durationSeconds: number;
  dayCount: number;
  lectureCount: number;
  enrollmentCount: number;
  postCount: number;
}

export interface RecordedCourseDetail extends Omit<RecordedCourseSummary, 'dayCount' | 'lectureCount' | 'postCount'> {
  config: ScheduleConfig | null;
  trainingHours: number | null;
  days: { id: string; title: string; postCount: number; lessons: { id: string; title: string; startSecond: number; endSecond: number }[] }[];
}

export interface DiscussionPostRow {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
  authorRole: UserRole;
  mine: boolean;
  replies: Omit<DiscussionPostRow, 'replies'>[];
}

export type CreatePostResult = { kind: 'ok'; id: string } | { kind: 'module_not_found' } | { kind: 'parent_not_found' };

export interface RecordedCourseRepository {
  /** null = the trainer isn't in this academy. */
  createRecordedCourse(tenantId: string, actor: Actor, input: NewRecordedCourse): Promise<string | null>;
  listRecordedCourses(tenantId: string): Promise<RecordedCourseSummary[]>;
  getRecordedCourse(tenantId: string, courseId: string): Promise<RecordedCourseDetail | null>;
  /** True when the user holds an ACTIVE enrollment in the course this module belongs to. */
  isEnrolledInModule(tenantId: string, userId: string, moduleId: string): Promise<boolean>;
  moduleExists(tenantId: string, moduleId: string): Promise<boolean>;
  listDiscussion(tenantId: string, moduleId: string, viewerId: string): Promise<DiscussionPostRow[]>;
  createPost(tenantId: string, userId: string, moduleId: string, parentId: string | null, body: string): Promise<CreatePostResult>;
}

const displayName = (u: { fullName: string | null; email: string }) => u.fullName ?? u.email.split('@')[0] ?? u.email;

const parseConfig = (raw: Prisma.JsonValue | null): ScheduleConfig | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const n = (k: keyof ScheduleConfig) => (typeof c[k] === 'number' ? (c[k] as number) : NaN);
  const config: ScheduleConfig = {
    maxLectureMinutes: n('maxLectureMinutes'),
    minLectureMinutes: n('minLectureMinutes'),
    breakMinutes: n('breakMinutes'),
    discussionMinutes: n('discussionMinutes'),
    dailyVideoMinutes: n('dailyVideoMinutes'),
  };
  return Object.values(config).every(Number.isFinite) ? config : null;
};

export { parseConfig as parseScheduleConfig };

export class PrismaRecordedCourseRepository implements RecordedCourseRepository {
  createRecordedCourse(tenantId: string, actor: Actor, input: NewRecordedCourse): Promise<string | null> {
    return withTenantTransaction(tenantId, async (tx) => {
      // FK checks bypass RLS: a trainer id from another academy would satisfy the constraint,
      // so ownership is re-checked inside the tenant-scoped transaction.
      const trainer = await tx.trainer.findFirst({ where: { tenantId, id: input.trainerId }, select: { id: true } });
      if (!trainer) return null;

      const course = await tx.course.create({
        data: {
          tenantId,
          trainerId: input.trainerId,
          title: input.title,
          description: input.description,
          type: 'RECORDED',
          price: new Prisma.Decimal(input.price),
          trainingHours: new Prisma.Decimal(input.trainingHours),
          durationDays: input.days.length,
          isPublished: input.isPublished,
          sourceVideoId: input.videoId,
          sourceDurationSeconds: input.durationSeconds,
          scheduleConfig: { ...input.config },
        },
        select: { id: true },
      });

      const mediaUrl = `https://www.youtube.com/watch?v=${input.videoId}`;
      for (const [d, day] of input.days.entries()) {
        const mod = await tx.module.create({ data: { tenantId, courseId: course.id, title: day.title, sortOrder: d }, select: { id: true } });
        await tx.lesson.createMany({
          data: day.lessons.map((l, i) => ({
            tenantId,
            moduleId: mod.id,
            title: l.title,
            contentType: 'YOUTUBE' as const,
            sortOrder: i,
            mediaUrl,
            startSecond: l.startSecond,
            endSecond: l.endSecond,
            durationSeconds: l.endSecond - l.startSecond,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.userId,
          actorRole: actor.role,
          action: 'course.created_from_youtube',
          entityType: 'course',
          entityId: course.id,
          metadata: { title: input.title, videoId: input.videoId, days: input.days.length, lectures: input.days.reduce((s, d) => s + d.lessons.length, 0) },
          ipAddress: actor.ip,
        },
      });
      return course.id;
    });
  }

  async listRecordedCourses(tenantId: string): Promise<RecordedCourseSummary[]> {
    const rows = await forTenant(tenantId).course.findMany({
      where: { tenantId, sourceVideoId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        isPublished: true,
        sourceVideoId: true,
        sourceDurationSeconds: true,
        _count: { select: { enrollments: true } },
        modules: { select: { _count: { select: { lessons: true, discussions: true } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      isPublished: c.isPublished,
      videoId: c.sourceVideoId ?? '',
      durationSeconds: c.sourceDurationSeconds ?? 0,
      dayCount: c.modules.length,
      lectureCount: c.modules.reduce((s, m) => s + m._count.lessons, 0),
      enrollmentCount: c._count.enrollments,
      postCount: c.modules.reduce((s, m) => s + m._count.discussions, 0),
    }));
  }

  async getRecordedCourse(tenantId: string, courseId: string): Promise<RecordedCourseDetail | null> {
    const c = await forTenant(tenantId).course.findFirst({
      where: { tenantId, id: courseId, sourceVideoId: { not: null } },
      select: {
        id: true,
        title: true,
        isPublished: true,
        sourceVideoId: true,
        sourceDurationSeconds: true,
        scheduleConfig: true,
        trainingHours: true,
        _count: { select: { enrollments: true } },
        modules: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            _count: { select: { discussions: true } },
            lessons: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, startSecond: true, endSecond: true } },
          },
        },
      },
    });
    if (!c) return null;
    return {
      id: c.id,
      title: c.title,
      isPublished: c.isPublished,
      videoId: c.sourceVideoId ?? '',
      durationSeconds: c.sourceDurationSeconds ?? 0,
      enrollmentCount: c._count.enrollments,
      config: parseConfig(c.scheduleConfig),
      trainingHours: c.trainingHours ? c.trainingHours.toNumber() : null,
      days: c.modules.map((m) => ({
        id: m.id,
        title: m.title,
        postCount: m._count.discussions,
        lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, startSecond: l.startSecond ?? 0, endSecond: l.endSecond ?? 0 })),
      })),
    };
  }

  async isEnrolledInModule(tenantId: string, userId: string, moduleId: string): Promise<boolean> {
    const mod = await forTenant(tenantId).module.findFirst({
      where: { tenantId, id: moduleId, course: { enrollments: { some: { tenantId, userId, status: 'ACTIVE' } } } },
      select: { id: true },
    });
    return mod !== null;
  }

  async moduleExists(tenantId: string, moduleId: string): Promise<boolean> {
    return (await forTenant(tenantId).module.findFirst({ where: { tenantId, id: moduleId }, select: { id: true } })) !== null;
  }

  async listDiscussion(tenantId: string, moduleId: string, viewerId: string): Promise<DiscussionPostRow[]> {
    const author = { select: { id: true, fullName: true, email: true, role: true } } as const;
    const rows = await forTenant(tenantId).discussionPost.findMany({
      where: { tenantId, moduleId, parentId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        body: true,
        createdAt: true,
        user: author,
        replies: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, createdAt: true, user: author } },
      },
    });
    const view = (p: { id: string; body: string; createdAt: Date; user: { id: string; fullName: string | null; email: string; role: UserRole } }) => ({
      id: p.id,
      body: p.body,
      createdAt: p.createdAt,
      authorName: displayName(p.user),
      authorRole: p.user.role,
      mine: p.user.id === viewerId,
    });
    return rows.map((p) => ({ ...view(p), replies: p.replies.map(view) }));
  }

  createPost(tenantId: string, userId: string, moduleId: string, parentId: string | null, body: string): Promise<CreatePostResult> {
    return withTenantTransaction(tenantId, async (tx) => {
      const mod = await tx.module.findFirst({ where: { tenantId, id: moduleId }, select: { id: true } });
      if (!mod) return { kind: 'module_not_found' } as const;
      if (parentId) {
        // Replies attach to a top-level question in the same day only (one reply level).
        const parent = await tx.discussionPost.findFirst({ where: { tenantId, id: parentId, moduleId, parentId: null }, select: { id: true } });
        if (!parent) return { kind: 'parent_not_found' } as const;
      }
      const { id } = await tx.discussionPost.create({ data: { tenantId, moduleId, userId, parentId, body }, select: { id: true } });
      return { kind: 'ok', id } as const;
    });
  }
}
