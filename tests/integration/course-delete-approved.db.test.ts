/**
 * Owner-approved deletion of a course WITH trainees, against a REAL PostgreSQL instance (RLS on): the course, its enrollments,
 * progress and certificates go; the tax invoice stays; other courses and academies are untouched. Also checks that the
 * one-time code row keeps what it approves (subject) and that the hourly counter can be narrowed by purpose.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Owner-approved course deletion (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/provider/provider.repository').PrismaProviderRepository;
  let otpRepo: import('../../src/modules/auth/auth.repository').PrismaOtpRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const t1 = randomUUID();
  const t2 = randomUUID();
  const courseDel = randomUUID(); // the course to delete
  const courseKeep = randomUUID(); // another course of the same academy
  const courseB = randomUUID(); // a course of another academy
  const modDel = randomUUID();
  const lessonDel = randomUUID();
  const enrDel1 = randomUUID();
  const enrDel2 = randomUUID();
  const enrKeep = randomUUID();
  const certificate = randomUUID();
  const certCode = `CERT-${certificate.slice(0, 8).toUpperCase()}`;
  const actor = { userId: admin, role: 'TENANT_ADMIN' as const, ip: '127.0.0.1' };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaProviderRepository } = require('../../src/modules/provider/provider.repository') as typeof import('../../src/modules/provider/provider.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaOtpRepository } = require('../../src/modules/auth/auth.repository') as typeof import('../../src/modules/auth/auth.repository');
    repo = new PrismaProviderRepository();
    otpRepo = new PrismaOtpRepository();

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: admin, tenantId: tenantA, email: 'admin@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: t1, tenantId: tenantA, email: 't1@corp.test', passwordHash: 'x', role: 'LEARNER' },
          { id: t2, tenantId: tenantA, email: 't2@corp.test', passwordHash: 'x', role: 'LEARNER' },
        ],
      });
      await tx.trainer.create({ data: { id: admin, tenantId: tenantA, userId: admin, fullName: 'Trainer' } });
      for (const id of [courseDel, courseKeep]) {
        await tx.course.create({ data: { id, tenantId: tenantA, trainerId: admin, title: id === courseDel ? 'To delete' : 'To keep', type: 'RECORDED', price: '0.00' } });
      }
      await tx.module.create({ data: { id: modDel, tenantId: tenantA, courseId: courseDel, title: 'Day 1', sortOrder: 1 } });
      await tx.lesson.create({ data: { id: lessonDel, tenantId: tenantA, moduleId: modDel, title: 'L', contentType: 'PDF' } });
      await tx.enrollment.createMany({
        data: [
          { id: enrDel1, tenantId: tenantA, userId: t1, courseId: courseDel },
          { id: enrDel2, tenantId: tenantA, userId: t2, courseId: courseDel },
          { id: enrKeep, tenantId: tenantA, userId: t1, courseId: courseKeep },
        ],
      });
      await tx.lessonProgress.create({ data: { tenantId: tenantA, enrollmentId: enrDel1, lessonId: lessonDel } });
      await tx.certificate.create({ data: { id: certificate, tenantId: tenantA, enrollmentId: enrDel1, certificateCode: certCode } });
      await tx.quizAttempt.create({ data: { tenantId: tenantA, courseId: courseDel, moduleId: modDel, userId: t1, expiresAt: new Date(Date.now() + 600_000), questions: [] } });
      await tx.invoice.create({
        data: {
          tenantId: tenantA, enrollmentId: enrDel1, userId: t1, invoiceNumber: `INV-${certificate}`, issuedAt: new Date(), subtotalAmount: '100.00', vatAmount: '15.00',
          totalAmount: '115.00', paymentMethod: 'MADA', paymentReference: 'ref-1', zatcaQr: 'qr',
        },
      });
    });
    await db.prisma.certificateRegistry.create({ data: { code: certCode, tenantId: tenantA, certificateId: certificate } });
    await db.withTenantTransaction(tenantB, async (tx) => {
      await tx.user.create({ data: { id: randomUUID(), tenantId: tenantB, email: 'b@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' } });
      const bAdmin = (await tx.user.findFirstOrThrow({ where: { tenantId: tenantB } })).id;
      await tx.trainer.create({ data: { id: bAdmin, tenantId: tenantB, userId: bAdmin, fullName: 'B trainer' } });
      await tx.course.create({ data: { id: courseB, tenantId: tenantB, trainerId: bAdmin, title: 'B course', type: 'LIVE', price: '0.00' } });
    });
  });

  afterAll(async () => {
    await db.prisma.certificateRegistry.deleteMany({ where: { tenantId: tenantA } });
    await db.prisma.loginOtp.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.invoice.deleteMany({ where: { tenantId } });
        await tx.certificate.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const inA = <T>(fn: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>) => db.withTenantTransaction(tenantA, fn);

  it('the ordinary delete still refuses a course that has trainees (nothing changes without the approved path)', async () => {
    expect(await repo.deleteCourse(tenantA, actor, courseDel)).toBe('in_use');
    expect(await inA((tx) => tx.course.count({ where: { id: courseDel } }))).toBe(1);
  });

  it('an unknown course, or another academy\'s course, is not found and nothing is touched', async () => {
    expect(await repo.deleteCourseWithEnrollments(tenantA, actor, randomUUID())).toBeNull();
    expect(await repo.deleteCourseWithEnrollments(tenantA, actor, courseB)).toBeNull();
    expect(await db.withTenantTransaction(tenantB, (tx) => tx.course.count({ where: { id: courseB } }))).toBe(1);
  });

  it('deletes the course with its enrollments, progress, quiz attempts and certificates (and their public lookup entry)', async () => {
    expect(await repo.deleteCourseWithEnrollments(tenantA, actor, courseDel)).toEqual({ enrollments: 2, certificates: 1 });
    await inA(async (tx) => {
      expect(await tx.course.count({ where: { id: courseDel } })).toBe(0);
      expect(await tx.module.count({ where: { courseId: courseDel } })).toBe(0);
      expect(await tx.lesson.count({ where: { id: lessonDel } })).toBe(0);
      expect(await tx.enrollment.count({ where: { courseId: courseDel } })).toBe(0);
      expect(await tx.lessonProgress.count({ where: { enrollmentId: enrDel1 } })).toBe(0);
      expect(await tx.certificate.count({ where: { id: certificate } })).toBe(0);
      expect(await tx.quizAttempt.count({ where: { courseId: courseDel } })).toBe(0);
    });
    expect(await db.prisma.certificateRegistry.count({ where: { certificateId: certificate } })).toBe(0);
  });

  it('keeps the tax invoice (link to the enrollment cleared), the trainees themselves, and their other course', async () => {
    await inA(async (tx) => {
      const invoices = await tx.invoice.findMany({ where: { tenantId: tenantA }, select: { enrollmentId: true, totalAmount: true } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]?.enrollmentId).toBeNull();
      expect(Number(invoices[0]?.totalAmount)).toBe(115);
      expect(await tx.user.count({ where: { id: { in: [t1, t2] } } })).toBe(2);
      expect(await tx.course.count({ where: { id: courseKeep } })).toBe(1);
      expect(await tx.enrollment.count({ where: { id: enrKeep } })).toBe(1);
      const log = await tx.auditLog.findFirst({ where: { tenantId: tenantA, action: 'course.deleted_with_enrollments', entityId: courseDel } });
      expect(log?.metadata).toMatchObject({ approvedBy: 'platform_owner', enrollments: 2, certificates: 1 });
    });
  });

  it('the one-time code row remembers what it approves, and the hourly count can be narrowed by purpose', async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    const subject = randomUUID();
    const approval = await otpRepo.create({ tenantId: tenantA, email: 'admin@corp.test', userId: admin, purpose: 'course_delete', expiresAt, subjectId: subject });
    await otpRepo.create({ tenantId: tenantA, email: 'admin@corp.test', userId: admin, purpose: 'login', expiresAt });
    expect((await otpRepo.find(approval))?.subjectId).toBe(subject);

    const since = new Date(Date.now() - 3_600_000);
    expect(await otpRepo.countRecent(tenantA, 'admin@corp.test', since)).toBe(2);
    expect(await otpRepo.countRecent(tenantA, 'admin@corp.test', since, 'course_delete')).toBe(1);
  });
});
