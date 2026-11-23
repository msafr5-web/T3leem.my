/**
 * Full erasure of a trainee against a REAL PostgreSQL instance (RLS on): every table that holds the person's data is
 * filled first, then everything must be gone while neighbours, invoices and other academies stay untouched.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Platform owner erases a trainee completely (real database)', () => {
  let db: typeof import('../../src/config/database');
  let repo: import('../../src/modules/platform/owner.repository').PrismaOwnerRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminA = randomUUID();
  const victim = randomUUID(); // the trainee to erase
  const neighbour = randomUUID(); // another trainee of the same academy
  const sameEmailInB = randomUUID(); // a different person with the SAME e-mail in another academy
  const course = randomUUID();
  const moduleId = randomUUID();
  const lesson = randomUUID();
  const victimEnrollment = randomUUID();
  const neighbourEnrollment = randomUUID();
  const certificate = randomUUID();
  const certCode = `CERT-${certificate.slice(0, 8).toUpperCase()}`; // the registry only accepts A-Z, 0-9 and dashes
  const classroom = randomUUID();
  const email = 'victim@corp.test';

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaOwnerRepository } = require('../../src/modules/platform/owner.repository') as typeof import('../../src/modules/platform/owner.repository');
    repo = new PrismaOwnerRepository(db.prisma);

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'A', slug: `a-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'B', slug: `b-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    await db.withTenantTransaction(tenantA, async (tx) => {
      await tx.user.createMany({
        data: [
          { id: adminA, tenantId: tenantA, email: 'admin@corp.test', passwordHash: 'x', role: 'TENANT_ADMIN' },
          { id: victim, tenantId: tenantA, email, fullName: 'Victim Person', phone: '+966551110001', employeeNo: 'E-1', passwordHash: 'x', role: 'LEARNER' },
          { id: neighbour, tenantId: tenantA, email: 'neighbour@corp.test', passwordHash: 'x', role: 'LEARNER' },
        ],
      });
      await tx.trainer.create({ data: { id: adminA, tenantId: tenantA, userId: adminA, fullName: 'Trainer' } });
      await tx.course.create({ data: { id: course, tenantId: tenantA, trainerId: adminA, title: 'C', type: 'RECORDED', price: '0.00' } });
      await tx.module.create({ data: { id: moduleId, tenantId: tenantA, courseId: course, title: 'Day 1', sortOrder: 1 } });
      await tx.lesson.create({ data: { id: lesson, tenantId: tenantA, moduleId, title: 'L', contentType: 'PDF' } });
      await tx.enrollment.createMany({
        data: [
          { id: victimEnrollment, tenantId: tenantA, userId: victim, courseId: course, source: 'ADMIN' },
          { id: neighbourEnrollment, tenantId: tenantA, userId: neighbour, courseId: course, source: 'ADMIN' },
        ],
      });
      await tx.lessonProgress.createMany({
        data: [
          { tenantId: tenantA, enrollmentId: victimEnrollment, lessonId: lesson },
          { tenantId: tenantA, enrollmentId: neighbourEnrollment, lessonId: lesson },
        ],
      });
      await tx.certificate.create({ data: { id: certificate, tenantId: tenantA, enrollmentId: victimEnrollment, certificateCode: certCode } });
      await tx.quizAttempt.create({ data: { tenantId: tenantA, courseId: course, moduleId, userId: victim, expiresAt: new Date(Date.now() + 600_000), questions: [] } });
      await tx.discussionPost.create({ data: { tenantId: tenantA, moduleId, userId: victim, body: 'hello' } });
      await tx.invoice.create({
        data: {
          tenantId: tenantA, enrollmentId: victimEnrollment, userId: victim, invoiceNumber: `INV-${victim}`, issuedAt: new Date(), subtotalAmount: '100.00', vatAmount: '15.00',
          totalAmount: '115.00', paymentMethod: 'MADA', paymentReference: 'ref-1', zatcaQr: 'qr',
        },
      });
      await tx.virtualClassroom.create({ data: { id: classroom, tenantId: tenantA, title: 'Live', startsAt: new Date(), durationMinutes: 60 } });
      await tx.classroomAttendance.createMany({
        data: [
          { tenantId: tenantA, classroomId: classroom, userId: victim, participantKey: 'k1', participantName: 'Victim Person', participantEmail: email, joinedAt: new Date() },
          // Joined Zoom without a linked account, but with the same e-mail: still this person's data.
          { tenantId: tenantA, classroomId: classroom, userId: null, participantKey: 'k2', participantName: 'Victim (guest)', participantEmail: email, joinedAt: new Date() },
          { tenantId: tenantA, classroomId: classroom, userId: neighbour, participantKey: 'k3', participantName: 'Neighbour', participantEmail: 'neighbour@corp.test', joinedAt: new Date() },
        ],
      });
      await tx.auditLog.create({ data: { tenantId: tenantA, actorId: adminA, actorRole: 'TENANT_ADMIN', action: 'trainee.created', entityType: 'user', entityId: victim, metadata: { email } } });
    });
    await db.prisma.certificateRegistry.create({ data: { code: certCode, tenantId: tenantA, certificateId: certificate } });
    await db.prisma.loginOtp.create({ data: { tenantId: tenantA, email, userId: victim, codeHash: 'h', expiresAt: new Date(Date.now() + 60_000) } });
    await db.withTenantTransaction(tenantB, async (tx) => {
      await tx.user.create({ data: { id: sameEmailInB, tenantId: tenantB, email, passwordHash: 'x', role: 'LEARNER' } });
    });
  });

  afterAll(async () => {
    await db.prisma.certificateRegistry.deleteMany({ where: { tenantId: tenantA } });
    await db.prisma.loginOtp.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.invoice.deleteMany({ where: { tenantId } });
        await tx.classroomAttendance.deleteMany({ where: { tenantId } });
        await tx.virtualClassroom.deleteMany({ where: { tenantId } });
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

  it('refuses a wrong confirmation e-mail, an unknown id, a trainer/admin account, and another academy, changing nothing', async () => {
    expect(await repo.eraseTrainee(tenantA, victim, 'wrong@corp.test')).toEqual({ kind: 'email_mismatch' });
    expect(await repo.eraseTrainee(tenantA, randomUUID(), email)).toEqual({ kind: 'not_found' });
    expect(await repo.eraseTrainee(tenantA, adminA, 'admin@corp.test')).toEqual({ kind: 'not_found' }); // never an admin
    expect(await repo.eraseTrainee(tenantB, victim, email)).toEqual({ kind: 'not_found' }); // right id, wrong academy
    expect(await inA((tx) => tx.user.count({ where: { id: { in: [victim, adminA] } } }))).toBe(2);
  });

  it('lists trainees with the counts that would be erased', async () => {
    const rows = await repo.listTrainees(tenantA);
    expect(rows.find((r) => r.id === victim)).toMatchObject({ email, enrollmentCount: 1, certificateCount: 1, employeeNo: 'E-1' });
    expect(rows.map((r) => r.id)).not.toContain(adminA);
    expect((await repo.listTrainees(tenantB)).map((r) => r.id)).toEqual([sameEmailInB]);
  });

  it('erases the person everywhere and reports counts', async () => {
    const r = await repo.eraseTrainee(tenantA, victim, email);
    expect(r).toEqual({
      kind: 'erased',
      summary: { enrollments: 1, certificates: 1, quizAttempts: 1, discussionPosts: 1, attendanceRecords: 2, invoicesKept: 1 },
    });

    await inA(async (tx) => {
      expect(await tx.user.count({ where: { id: victim } })).toBe(0);
      expect(await tx.enrollment.count({ where: { userId: victim } })).toBe(0);
      expect(await tx.lessonProgress.count({ where: { enrollmentId: victimEnrollment } })).toBe(0);
      expect(await tx.certificate.count({ where: { id: certificate } })).toBe(0);
      expect(await tx.quizAttempt.count({ where: { userId: victim } })).toBe(0);
      expect(await tx.discussionPost.count({ where: { userId: victim } })).toBe(0);
      expect(await tx.classroomAttendance.count({ where: { participantEmail: email } })).toBe(0);
      expect(await tx.loginOtp.count({ where: { email, tenantId: tenantA } })).toBe(0);
    });
    expect(await db.prisma.certificateRegistry.count({ where: { certificateId: certificate } })).toBe(0);
  });

  it('keeps the tax invoice (without its link to the deleted enrollment), blanks old audit details, and records the erasure', async () => {
    await inA(async (tx) => {
      const invoices = await tx.invoice.findMany({ where: { tenantId: tenantA }, select: { enrollmentId: true, totalAmount: true } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]?.enrollmentId).toBeNull();
      expect(Number(invoices[0]?.totalAmount)).toBe(115);

      const created = await tx.auditLog.findFirst({ where: { tenantId: tenantA, action: 'trainee.created', entityId: victim } });
      expect(created?.metadata).toEqual({ redacted: true });
      const erased = await tx.auditLog.findFirst({ where: { tenantId: tenantA, action: 'trainee.erased', entityId: victim } });
      expect(erased?.actorRole).toBe('SUPER_ADMIN');
      expect(JSON.stringify(erased?.metadata)).not.toContain(email);
    });
  });

  it("leaves the neighbour trainee, the admin, and the same e-mail's owner in another academy untouched", async () => {
    await inA(async (tx) => {
      expect(await tx.user.count({ where: { id: { in: [neighbour, adminA] } } })).toBe(2);
      expect(await tx.enrollment.count({ where: { id: neighbourEnrollment } })).toBe(1);
      expect(await tx.lessonProgress.count({ where: { enrollmentId: neighbourEnrollment } })).toBe(1);
      expect(await tx.classroomAttendance.count({ where: { userId: neighbour } })).toBe(1);
    });
    expect(await db.withTenantTransaction(tenantB, (tx) => tx.user.count({ where: { id: sameEmailInB } }))).toBe(1);
  });

  it('is repeatable: erasing the same person again says not found', async () => {
    expect(await repo.eraseTrainee(tenantA, victim, email)).toEqual({ kind: 'not_found' });
  });
});
