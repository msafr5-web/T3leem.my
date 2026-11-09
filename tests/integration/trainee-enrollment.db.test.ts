/**
 * Corporate-trainee enrollment against a REAL PostgreSQL instance (the real repository, RLS on).
 * Skipped when TEST_DATABASE_URL is unset. Requires `npm run db:migrate:test` to have applied the latest migration.
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../src/modules/provider/provider.types';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Admin enrolls corporate trainees (real database)', () => {
  let db: typeof import('../../src/config/database');
  let service: import('../../src/modules/provider/provider.service').ProviderService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminA = randomUUID();
  const courseA = randomUUID();
  const courseA2 = randomUUID();
  const courseB = randomUUID();
  const actor = (userId: string): Actor => ({ userId, role: 'TENANT_ADMIN', ip: '127.0.0.1' });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_PUBLIC_KEY_BASE64 ??= Buffer.from('unused').toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as typeof import('../../src/config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaProviderRepository } = require('../../src/modules/provider/provider.repository') as typeof import('../../src/modules/provider/provider.repository');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProviderService } = require('../../src/modules/provider/provider.service') as typeof import('../../src/modules/provider/provider.service');
    service = new ProviderService({ repository: new PrismaProviderRepository(), hashPassword: async (p) => `hashed:${p.length}` });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Hila', slug: `hila-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'Other', slug: `other-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    for (const [tenantId, userId, courseIds] of [
      [tenantA, adminA, [courseA, courseA2]],
      [tenantB, randomUUID(), [courseB]],
    ] as const) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.user.create({ data: { id: userId, tenantId, email: `admin@${tenantId}.test`, passwordHash: 'x', role: 'TENANT_ADMIN' } });
        await tx.trainer.create({ data: { id: userId, tenantId, userId, fullName: 'Trainer' } });
        for (const id of courseIds) {
          await tx.course.create({ data: { id, tenantId, trainerId: userId, title: `Course ${id}`, type: 'LIVE', price: '0.00', isPublished: false } });
        }
      });
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.enrollment.deleteMany({ where: { tenantId } });
        await tx.course.deleteMany({ where: { tenantId } });
        await tx.trainer.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  const person = (email: string, extra: { phone?: string; employeeNo?: string } = {}) => ({ fullName: 'Valid Name', email, ...extra });

  it('creates accounts with phone and staff number, enrolls them as ADMIN source without any invoice', async () => {
    const out = await service.enrollTrainees(tenantA, actor(adminA), courseA, [
      person('ali@hila.test', { phone: '0551110001', employeeNo: 'E-1' }),
      person('sara@hila.test', { phone: '0551110002', employeeNo: 'E-2' }),
    ]);
    expect(out.map((r) => [r.email, r.status, r.accountCreated])).toEqual([
      ['ali@hila.test', 'enrolled', true],
      ['sara@hila.test', 'enrolled', true],
    ]);

    const roster = await service.courseRoster(tenantA, courseA);
    expect(roster.map((r) => [r.email, r.phone, r.employeeNo, r.source, r.status])).toEqual([
      ['ali@hila.test', '+966551110001', 'E-1', 'ADMIN', 'ACTIVE'],
      ['sara@hila.test', '+966551110002', 'E-2', 'ADMIN', 'ACTIVE'],
    ]);
    const invoices = await db.withTenantTransaction(tenantA, (tx) => tx.invoice.count({ where: { tenantId: tenantA } }));
    expect(invoices).toBe(0);
  });

  it('is idempotent: running the same list again enrolls nobody twice', async () => {
    const out = await service.enrollTrainees(tenantA, actor(adminA), courseA, [person('ali@hila.test'), person('new@hila.test')]);
    expect(out.map((r) => [r.email, r.status, r.accountCreated])).toEqual([
      ['ali@hila.test', 'already_enrolled', false],
      ['new@hila.test', 'enrolled', true],
    ]);
    expect(await service.courseRoster(tenantA, courseA)).toHaveLength(3);
  });

  it('enrolls an existing trainee into a second course without a new account, and fills only EMPTY phone / staff number', async () => {
    const out = await service.enrollTrainees(tenantA, actor(adminA), courseA2, [
      person('new@hila.test', { phone: '0551110009', employeeNo: 'E-9' }), // had neither -> filled
      person('ali@hila.test', { phone: '0551119999', employeeNo: 'E-99' }), // has both -> kept
    ]);
    expect(out.every((r) => r.status === 'enrolled' && !r.accountCreated)).toBe(true);
    const roster = await service.courseRoster(tenantA, courseA2);
    const byEmail = Object.fromEntries(roster.map((r) => [r.email, r]));
    expect(byEmail['new@hila.test']).toMatchObject({ phone: '+966551110009', employeeNo: 'E-9' });
    expect(byEmail['ali@hila.test']).toMatchObject({ phone: '+966551110001', employeeNo: 'E-1' });
  });

  it('reports a clash on one row but still enrolls the others in the same request', async () => {
    const out = await service.enrollTrainees(tenantA, actor(adminA), courseA, [
      person('phoneclash@hila.test', { phone: '0551110001' }), // Ali's phone
      person('staffclash@hila.test', { employeeNo: 'E-2' }), // Sara's staff number
      person('admin@' + tenantA + '.test'), // an admin account, not a trainee
      person('fine@hila.test'),
    ]);
    expect(out.map((r) => r.status)).toEqual(['error', 'error', 'error', 'enrolled']);
    expect(out[0]?.message).toContain('الجوال');
    expect(out[1]?.message).toContain('الوظيفي');
    expect(out[2]?.message).toContain('إداري');
    const emails = (await service.courseRoster(tenantA, courseA)).map((r) => r.email);
    expect(emails).toContain('fine@hila.test');
    expect(emails).not.toContain('phoneclash@hila.test');
  });

  it("keeps academies apart: another academy's course is refused, and the same e-mail there is a different person", async () => {
    await expect(service.enrollTrainees(tenantA, actor(adminA), courseB, [person('x@hila.test')])).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });

    const out = await service.enrollTrainees(tenantB, actor(adminA), courseB, [person('ali@hila.test', { phone: '0551110001', employeeNo: 'E-1' })]);
    expect(out[0]).toMatchObject({ status: 'enrolled', accountCreated: true }); // same e-mail / phone / staff no. are free in B
    expect(await service.courseRoster(tenantB, courseB)).toHaveLength(1);
    await expect(service.courseRoster(tenantB, courseA)).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
  });

  it('records one audit row per batch with counts and no personal data', async () => {
    const rows = await db.withTenantTransaction(tenantA, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: tenantA, action: 'course.trainees_enrolled' }, orderBy: { createdAt: 'asc' }, select: { metadata: true } }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(rows)).not.toContain('@hila.test');
    expect(rows[0]?.metadata).toMatchObject({ requested: 2, enrolled: 2, accountsCreated: 2, errors: 0 });
  });
});
