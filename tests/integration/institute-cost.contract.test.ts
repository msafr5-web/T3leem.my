/**
 * The cost engine end to end on a REAL PostgreSQL database: versioned policy (draft -> approved, frozen by a trigger),
 * the monthly report built from real rooms, assets, bills, expenses, held sessions, students and invoices, the tariff
 * check of the electricity bill, sub-meter readings. Skipped when TEST_DATABASE_URL is unset.
 * Expected figures are worked out by hand in the comments, not copied from the engine.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, sign, tenants } from './helpers/test-app';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

type Db = typeof import('../../src/config/database');

const POLICY = {
  electricity: { tariffCategory: 'COMMERCIAL', allocation: 'POWER_HOURS', vatRatePercent: 15, vatRecoverable: false, breakerAmps: {} },
  depreciation: { start: 'PURCHASE_MONTH', defaultLifeMonths: 60 },
  overhead: { basis: 'AREA' },
  occupancy: { availableHoursPerMonth: 176 },
  revenue: { basis: 'CASH' },
};
const policyWith = (over: { electricity?: object; depreciation?: object; overhead?: object; occupancy?: object; revenue?: object }) => ({
  electricity: { ...POLICY.electricity, ...over.electricity },
  depreciation: { ...POLICY.depreciation, ...over.depreciation },
  overhead: { ...POLICY.overhead, ...over.overhead },
  occupancy: { ...POLICY.occupancy, ...over.occupancy },
  revenue: { ...POLICY.revenue, ...over.revenue },
});

describeDb('Institute cost engine API (real database)', () => {
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const created: string[] = []; // tenants made by world(), wiped at the end
  const managerUser = randomUUID();
  const financeUser = randomUUID();
  const affairsUser = randomUUID();

  const as = (token: string, tenant = tenantA) => ({
    get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    put: (p: string, body: object) => request(app).put(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    del: (p: string) => request(app).delete(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  });
  const tokenOf = (userId: string, role: string, tenant = tenantA) => sign({ sub: userId, tid: tenant, role });
  const hq = (tenant = tenantA) => as(tokenOf(randomUUID(), 'TENANT_ADMIN', tenant), tenant);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    /* eslint-disable @typescript-eslint/no-require-imports */
    db = require('../../src/config/database') as Db;
    const { PrismaInstituteRepository } = require('../../src/modules/institute/institute.repository') as typeof import('../../src/modules/institute/institute.repository');
    const { InstituteService } = require('../../src/modules/institute/institute.service') as typeof import('../../src/modules/institute/institute.service');
    const { PrismaAcademicRepository } = require('../../src/modules/institute/academic/academic.repository') as typeof import('../../src/modules/institute/academic/academic.repository');
    const { AcademicService } = require('../../src/modules/institute/academic/academic.service') as typeof import('../../src/modules/institute/academic/academic.service');
    const { PrismaFinanceRepository } = require('../../src/modules/institute/finance/finance.repository') as typeof import('../../src/modules/institute/finance/finance.repository');
    const { FinanceService } = require('../../src/modules/institute/finance/finance.service') as typeof import('../../src/modules/institute/finance/finance.service');
    const { PrismaCostRepository } = require('../../src/modules/institute/cost/cost.repository') as typeof import('../../src/modules/institute/cost/cost.repository');
    const { CostService } = require('../../src/modules/institute/cost/cost.service') as typeof import('../../src/modules/institute/cost/cost.service');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const instRepo = new PrismaInstituteRepository();
    const acadRepo = new PrismaAcademicRepository();
    const finRepo = new PrismaFinanceRepository();
    const instituteService = new InstituteService(instRepo);
    app = buildApp({
      instituteService,
      academicService: new AcademicService(acadRepo, instituteService, instRepo),
      financeService: new FinanceService(finRepo, instituteService, instRepo, acadRepo),
      costService: new CostService(new PrismaCostRepository(), instituteService, instRepo, acadRepo, finRepo),
    });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'CA', slug: `ca-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'CB', slug: `cb-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    for (const id of [tenantA, tenantB]) {
      tenants[id] = { id, slug: `x-${id}`, name: 'T', status: 'ACTIVE', legalName: null, vatNumber: null, brandSettings: {}, logoUpdatedAt: null, subscriptionEndsAt: null, features: { health: true, recorded: true, institute: true } };
    }
    await db.withTenantTransaction(tenantA, async (tx) => {
      for (const id of [managerUser, financeUser, affairsUser]) await tx.user.create({ data: { id, tenantId: tenantA, email: `${id}@t.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB, ...created]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.studentPayment.deleteMany({ where: { tenantId } });
        await tx.closedPeriod.deleteMany({ where: { tenantId } });
      });
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.invoiceInstallment.deleteMany({ where: { tenantId } });
        await tx.studentInvoice.deleteMany({ where: { tenantId } });
        await tx.expense.deleteMany({ where: { tenantId } });
        await tx.utilityBill.deleteMany({ where: { tenantId } });
        await tx.roomMeterReading.deleteMany({ where: { tenantId } });
        await tx.attendance.deleteMany({ where: { tenantId } });
        await tx.classSession.deleteMany({ where: { tenantId } });
        await tx.student.deleteMany({ where: { tenantId } });
        await tx.instructor.deleteMany({ where: { tenantId } });
        await tx.subject.deleteMany({ where: { tenantId } });
        await tx.level.deleteMany({ where: { tenantId } });
        await tx.program.deleteMany({ where: { tenantId } });
        await tx.assetMaintenance.deleteMany({ where: { tenantId } });
        await tx.asset.deleteMany({ where: { tenantId } });
        await tx.room.deleteMany({ where: { tenantId } });
        await tx.instituteMember.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
      // Approved policies are frozen and undeletable by design (even for the app role), so a test institute's approved
      // policy rows stay behind; only an unapproved draft can be removed. They belong to random throwaway tenant ids.
      await db.withTenantTransaction(tenantId, (tx) => tx.costPolicy.deleteMany({ where: { tenantId, status: 'DRAFT' } }));
      delete tenants[tenantId];
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB, ...created] } } });
    await db.prisma.$disconnect();
  });

  /**
   * A fresh institute (its own tenant, so policies do not leak between tests): Riyadh with a lab R1 (80 m2, 12 kW) and a
   * hall R2 (60 m2, 5 kW); each taught 10 h in Sept 2026 (five 2-hour held sessions). A 12,000.00 computer in R1 (10% residual,
   * 36 months, bought Jan 2026). Electricity bill 9,000.00 for 12,000 kWh. Expenses: 1,500.00 on R1 and 1,400.00 overhead.
   */
  async function world() {
    const tenant = randomUUID();
    tenants[tenant] = { ...tenants[tenantA]!, id: tenant, slug: `w-${tenant}` };
    await db.prisma.tenant.create({ data: { id: tenant, name: 'W', slug: `w-${tenant}`, status: 'ACTIVE' } });
    created.push(tenant);
    const users = { manager: randomUUID(), finance: randomUUID(), affairs: randomUUID() };
    await db.withTenantTransaction(tenant, async (tx) => {
      for (const id of Object.values(users)) await tx.user.create({ data: { id, tenantId: tenant, email: `${id}@t.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
    });
    const h = hq(tenant);
    const riyadh = (await h.post('/branches', { name: 'الرياض' })).body.data.id as string;
    const jeddah = (await h.post('/branches', { name: 'جدة' })).body.data.id as string;
    const r1 = (await h.post('/rooms', { branch_id: riyadh, name: 'R1', area_m2: 80, capacity: 20, power_kw: 12 })).body.data.id as string;
    const r2 = (await h.post('/rooms', { branch_id: riyadh, name: 'R2', area_m2: 60, capacity: 20, power_kw: 5 })).body.data.id as string;
    const program = (await h.post('/programs', { branch_id: riyadh, name: 'دبلوم الإدارة' })).body.data.id as string;
    const level = (await h.post(`/programs/${program}/levels`, { name: 'م1', sort_order: 1 })).body.data.id as string;
    const subject = (await h.post(`/levels/${level}/subjects`, { name: 'مادة', hours: 20 })).body.data.id as string; // 20 h = 1200 min
    const instrA = (await h.post('/instructors', { branch_id: riyadh, full_name: 'د. سعد', hourly_rate: '150.00' })).body.data.id as string;
    const instrB = (await h.post('/instructors', { branch_id: riyadh, full_name: 'أ. منى', hourly_rate: '100.00' })).body.data.id as string;
    const stud = async (name: string) => (await h.post('/students', { branch_id: riyadh, full_name: name, program_id: program, level_id: level })).body.data.id as string;
    const s1 = await stud('سارة');
    await stud('ليلى');
    await h.post('/assets', { branch_id: riyadh, room_id: r1, name: 'حاسب', purchase_date: '2026-01-10', purchase_value: '12000.00', salvage_percent: 10, useful_life_months: 36 });
    for (let day = 1; day <= 5; day++) {
      for (const [room, instr] of [[r1, instrA], [r2, instrB]] as const) {
        const slot = { starts_at: `2026-09-${String(day).padStart(2, '0')}T09:00:00+03:00`, ends_at: `2026-09-${String(day).padStart(2, '0')}T11:00:00+03:00` };
        const created = await h.post('/sessions', { subject_id: subject, room_id: room, instructor_id: instr, ...slot });
        expect(created.status).toBe(201);
        expect((await h.put(`/sessions/${created.body.data.id}`, { room_id: room, instructor_id: instr, ...slot, status: 'HELD' })).status).toBe(200);
      }
    }
    expect((await h.post('/finance/bills', { branch_id: riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '9000.00', kwh: '12000' })).status).toBe(201);
    expect((await h.post('/finance/expenses', { branch_id: riyadh, room_id: r1, category: 'صيانة', amount: '1500.00', incurred_on: '2026-09-10' })).status).toBe(201);
    expect((await h.post('/finance/expenses', { branch_id: riyadh, category: 'نظافة', amount: '1400.00', incurred_on: '2026-09-11' })).status).toBe(201);
    const inv = (await h.post('/finance/invoices', { student_id: s1, description: 'رسوم', amount: '6000', issued_on: '2026-08-01' })).body.data.id as string;
    expect((await h.post(`/finance/invoices/${inv}/payments`, { amount: '2500.00', paid_on: '2026-09-12' })).status).toBe(201);
    await h.put('/members', { email: `${users.manager}@t.test`, role: 'BRANCH_MANAGER', branch_id: riyadh });
    await h.put('/members', { email: `${users.finance}@t.test`, role: 'FINANCE' });
    await h.put('/members', { email: `${users.affairs}@t.test`, role: 'STUDENT_AFFAIRS', branch_id: riyadh });
    const t = (u: string) => as(tokenOf(u, 'INSTRUCTOR', tenant), tenant);
    return { tenant, h, riyadh, jeddah, r1, r2, program, subject, instrA, instrB, s1, mgr: t(users.manager), fin: t(users.finance), aff: t(users.affairs) };
  }
  const approve = async (w: Awaited<ReturnType<typeof world>>, policy: object = POLICY) => {
    expect((await w.fin.put('/cost/policy/draft', { policy })).status).toBe(200);
    expect((await w.h.post('/cost/policy/approve')).status).toBe(200);
  };
  const report = (a: ReturnType<typeof as>, w: Awaited<ReturnType<typeof world>>, month = '2026-09') => a.get(`/cost/report?branch_id=${w.riyadh}&month=${month}`);

  describe('the policy: draft, approval, freezing', () => {
    it('no report without an approved policy; the policy is validated strictly', async () => {
      const w = await world();
      const none = await report(w.h, w);
      expect([none.status, none.body.error.code]).toEqual([409, 'NO_APPROVED_POLICY']);
      const bad = await w.fin.put('/cost/policy/draft', { policy: { ...POLICY, electricity: { ...POLICY.electricity, allocation: 'GUESS', vatRatePercent: 150 }, depreciation: { start: 'NEVER', defaultLifeMonths: 0 }, revenue: { basis: 7 } } });
      expect([bad.status, bad.body.error.code]).toEqual([422, 'INVALID_POLICY']);
      expect(bad.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['depreciation.defaultLifeMonths', 'depreciation.start', 'electricity.allocation', 'electricity.vatRatePercent', 'revenue.basis']);
      expect((await w.fin.put('/cost/policy/draft', { policy: {} })).status).toBe(422);
      expect((await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { breakerAmps: { [randomUUID()]: 150 } } }) })).status).toBe(422); // unknown branch
      expect((await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { breakerAmps: { [w.riyadh]: 0 } } }) })).status).toBe(422);
      expect((await w.h.post('/cost/policy/approve')).body.error.code).toBe('NO_DRAFT_POLICY');
    });

    it('finance drafts, only head office approves; roles are enforced', async () => {
      const w = await world();
      expect((await w.aff.get('/cost/policy')).status).toBe(403);
      expect((await w.mgr.put('/cost/policy/draft', { policy: POLICY })).status).toBe(403);
      expect((await w.mgr.get('/cost/policy')).status).toBe(200); // a branch manager can read it
      const d = await w.fin.put('/cost/policy/draft', { policy: POLICY, note: 'سياسة 2026' });
      expect(d.body.data).toMatchObject({ version: 1, status: 'DRAFT', note: 'سياسة 2026' });
      expect((await w.fin.post('/cost/policy/approve')).status).toBe(403);
      expect((await w.mgr.post('/cost/policy/approve')).status).toBe(403);
      const a = await w.h.post('/cost/policy/approve');
      expect(a.body.data).toMatchObject({ version: 1, status: 'APPROVED' });
      expect(a.body.data.approved_by).toBeTruthy();
      expect((await w.fin.get('/cost/policy')).body.data).toMatchObject({ approved: { version: 1 }, draft: null, history: [] });
    });

    it('editing after approval makes a NEW version; approving it supersedes the old one, which stays on record', async () => {
      const w = await world();
      await approve(w);
      const second = await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { allocation: 'AREA' } }) });
      expect(second.body.data).toMatchObject({ version: 2, status: 'DRAFT' });
      expect((await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { allocation: 'AREA' }, overhead: { basis: 'HOURS' } }) })).body.data.version).toBe(2); // same draft edited in place
      const before = (await report(w.h, w)).body.data;
      expect(before.policy.version).toBe(1); // reports keep using the approved one until the draft is approved
      await w.h.post('/cost/policy/approve');
      const s = (await w.h.get('/cost/policy')).body.data;
      expect([s.approved.version, s.history.map((x: { version: number }) => x.version)]).toEqual([2, [1]]);
      expect(s.history[0].status).toBe('SUPERSEDED');
      expect((await report(w.h, w)).body.data.policy.version).toBe(2);
      expect((await w.fin.del('/cost/policy/draft')).body?.error?.code).toBe('NO_DRAFT_POLICY');
    });

    it('an approved policy is frozen by the database itself: no edit of its values, no delete, whoever asks', async () => {
      const w = await world();
      await approve(w);
      const row = await db.withTenantTransaction(w.tenant, (tx) => tx.costPolicy.findFirstOrThrow({ where: { tenantId: w.tenant, status: 'APPROVED' } }));
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.costPolicy.update({ where: { id: row.id }, data: { params: { electricity: { allocation: 'AREA' } } } }))).rejects.toThrow(/institute_policy_frozen/);
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.costPolicy.update({ where: { id: row.id }, data: { version: 99 } }))).rejects.toThrow(/institute_policy_frozen/);
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.costPolicy.delete({ where: { id: row.id } }))).rejects.toThrow(/institute_policy_frozen/);
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.costPolicy.update({ where: { id: row.id }, data: { status: 'DRAFT' } }))).rejects.toThrow(/institute_policy_frozen/); // cannot be reopened
    });

    it('a draft can be discarded', async () => {
      const w = await world();
      await w.fin.put('/cost/policy/draft', { policy: POLICY });
      expect((await w.fin.del('/cost/policy/draft')).status).toBe(204);
      expect((await w.h.get('/cost/policy')).body.data.draft).toBeNull();
    });
  });

  describe('the monthly cost report', () => {
    it('costs rooms and the programme under the approved policy, to the halala (power x hours, area overhead)', async () => {
      const w = await world();
      await approve(w);
      const r = (await report(w.fin, w)).body.data;
      // electricity 9,000.00 by kW x h: 12x600 = 7200 vs 5x600 = 3000 -> 6,352.94 / 2,647.06
      // R1: + depreciation 300.00 (month 9 of 36) + direct 1,500.00 + overhead 1,400.00 x 80/140 = 800.00 -> 8,952.94
      // R2: + overhead 600.00 -> 3,247.06 ; together 12,200.00
      const [a, b] = r.rooms as { name: string }[];
      expect(a).toMatchObject({ name: 'R1', electricity: '6352.94', depreciation: '300.00', direct_expenses: '1500.00', overhead: '800.00', total: '8952.94', held_minutes: 600, cost_per_hour: '895.29' });
      expect(b).toMatchObject({ name: 'R2', electricity: '2647.06', depreciation: '0.00', overhead: '600.00', total: '3247.06', cost_per_hour: '324.71' });
      expect(r.total_room_cost).toBe('12200.00');
      expect(r.electricity).toEqual({ method_used: 'POWER_HOURS', cost: '9000.00' });
      expect(r.rooms[0].occupancy_percent).toBe(5.7); // 10 of 176 hours
      // all 10 sessions absorb the rooms' cost; instructors: 10 h x 150.00 + 10 h x 100.00 = 2,500.00; 2 active students
      const p = r.programs[0];
      expect(p).toMatchObject({ name: 'دبلوم الإدارة', held_minutes: 1200, facility_cost: '12200.00', instructor_cost: '2500.00', total_cost: '14700.00', active_students: 2, cost_per_student: '7350.00' });
      expect(p).toMatchObject({ revenue: '2500.00', profit: '-12200.00' }); // cash collected in September
      expect(r.idle_cost).toBe('0.00');
      expect(r.policy.version).toBe(1);
      expect(r.warnings).toEqual([]);
    });

    it('re-running gives exactly the same figures (deterministic), and another month is empty', async () => {
      const w = await world();
      await approve(w);
      const a = (await report(w.h, w)).body.data;
      const b = (await report(w.h, w)).body.data;
      expect(b).toEqual(a);
      const oct = (await report(w.h, w, '2026-10')).body.data;
      expect(oct.total_room_cost).toBe('300.00'); // only the computer's depreciation (month 10)
      expect(oct.warnings).toEqual([{ code: 'NO_BILL' }]);
      expect(oct.rooms.every((x: { cost_per_hour: string | null }) => x.cost_per_hour === null)).toBe(true);
      expect(oct.idle_cost).toBe('300.00');
    });

    it('area allocation, hours overhead, and electricity net of recoverable VAT change the figures as the policy says', async () => {
      const w = await world();
      await approve(w, policyWith({ electricity: { allocation: 'AREA' } }));
      const byArea = (await report(w.h, w)).body.data;
      expect(byArea.rooms.map((x: { electricity: string }) => x.electricity)).toEqual(['5142.86', '3857.14']);
      await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { allocation: 'POWER_HOURS', vatRecoverable: true }, overhead: { basis: 'HOURS' } }) });
      await w.h.post('/cost/policy/approve');
      // the bill states no VAT: net = 9,000.00 / 1.15 = 7,826.09 (estimated, and flagged). Overhead by held hours is 50 / 50.
      const net = (await report(w.h, w)).body.data;
      expect(net.electricity.cost).toBe('7826.09');
      expect(net.warnings).toContainEqual({ code: 'BILL_NET_OF_VAT_ESTIMATED' });
      expect(net.rooms.map((x: { overhead: string }) => x.overhead)).toEqual(['700.00', '700.00']);
    });

    it('uses the VAT stated on the bill when there is one', async () => {
      const w = await world();
      await w.h.del(`/finance/bills/${(await w.h.get('/finance/bills')).body.data.bills[0].id}`);
      expect((await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '9000.00', kwh: '12000', vat_amount: '1173.91' })).status).toBe(201);
      expect((await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2026-10-01', period_end: '2026-10-31', amount: '100', vat_amount: '101' })).status).toBe(422);
      await approve(w, policyWith({ electricity: { vatRecoverable: true } }));
      const r = (await report(w.h, w)).body.data;
      expect(r.electricity.cost).toBe('7826.09'); // 9,000.00 - 1,173.91
      expect(r.warnings).toEqual([]);
    });

    it('by meter: a sub-metered room bears its kWh share, common areas are shared by area', async () => {
      const w = await world();
      await approve(w, policyWith({ electricity: { allocation: 'METER' } }));
      // bill 12,000 kWh; R1 sub-meter 6,000 kWh -> 4,500.00 ; remaining 4,500.00 by area 80:60 -> 2,571.43 / 1,928.57
      expect((await w.mgr.put('/cost/meter-readings', { room_id: w.r1, month: '2026-09', kwh: '6000' })).status).toBe(200);
      const r = (await report(w.h, w)).body.data;
      expect(r.electricity.method_used).toBe('METER');
      expect(r.rooms.map((x: { electricity: string }) => x.electricity)).toEqual(['7071.43', '1928.57']);
      // a reading is replaced, not duplicated; listed, deleted
      await w.mgr.put('/cost/meter-readings', { room_id: w.r1, month: '2026-09', kwh: '3000' });
      const list = (await w.h.get('/cost/meter-readings?month=2026-09')).body.data.readings;
      expect(list).toHaveLength(1);
      expect(list[0].kwh).toBe('3000.00');
      expect((await w.mgr.del(`/cost/meter-readings/${list[0].id}`)).status).toBe(204);
      const none = (await report(w.h, w)).body.data;
      expect(none.electricity.method_used).toBe('POWER_HOURS'); // no readings: falls back, and says so
      expect(none.warnings).toContainEqual({ code: 'NO_BILL_KWH_FALLBACK_POWER_HOURS' });
    });

    it('an asset that was retired stops depreciating after that month; assets with gaps are reported, not guessed', async () => {
      const w = await world();
      await approve(w);
      const pc = (await w.h.get('/assets')).body.data.assets[0].id as string;
      expect((await w.h.put(`/assets/${pc}`, { name: 'حاسب', room_id: w.r1, purchase_date: '2026-01-10', purchase_value: '12000.00', salvage_percent: 10, useful_life_months: 36, status: 'RETIRED', retired_on: '2026-08-20' })).status).toBe(200);
      expect((await report(w.h, w)).body.data.rooms[0].depreciation).toBe('0.00'); // retired in August
      expect((await report(w.h, w, '2026-08')).body.data.rooms[0].depreciation).toBe('300.00'); // still charged for the month it was retired
      await w.h.post('/assets', { branch_id: w.riyadh, name: 'بلا تاريخ', purchase_value: '500.00' });
      const warned = (await report(w.h, w)).body.data.warnings as { code: string }[];
      expect(warned.map((x) => x.code)).toContain('ASSET_NO_PURCHASE_DATE');
    });

    it('over time: tuition is recognised in proportion to the hours delivered (IFRS 15, input method)', async () => {
      const w = await world();
      await approve(w, policyWith({ revenue: { basis: 'OVER_TIME' } }));
      // programme = 20 h = 1200 min; 1200 min were held in Sept and none before -> 100% of the 6,000.00 invoice in September
      const sep = (await report(w.h, w)).body.data.programs[0];
      expect(sep.revenue).toBe('6000.00');
      expect((await report(w.h, w, '2026-10')).body.data.programs[0].revenue).toBe('0.00'); // nothing more to recognise
      expect((await report(w.h, w, '2026-08')).body.data.programs[0].revenue).toBe('0.00'); // nothing delivered yet
    });
  });

  describe('checking the electricity bill against the Saudi tariff', () => {
    it('September 2026 commercial: 22 / 32 halalas, VAT 15%, fixed charge not on record', async () => {
      const w = await world();
      await approve(w);
      // 6,000 x 0.22 = 1,320.00 ; 6,000 x 0.32 = 1,920.00 ; energy 3,240.00 ; VAT 486.00 ; 3,726.00. The bill paid is 9,000.00
      const c = (await report(w.h, w)).body.data.bill_check;
      expect(c).toMatchObject({ tariff_id: 'SE-2018-COMMERCIAL', actual: '9000.00', level: 'REVIEW', difference: '5274.00' });
      expect(c.estimate).toMatchObject({ energy: '3240.00', fixed: null, vat: '486.00', total: '3726.00', warnings: ['FIXED_CHARGE_NOT_ON_RECORD'] });
      expect(c.estimate.tiers).toEqual([{ kwh: 6000, halalas_per_kwh: 22, amount: '1320.00' }, { kwh: 6000, halalas_per_kwh: 32, amount: '1920.00' }]);
    });

    it('a bill that matches the tariff is OK; 2027 uses 25 / 35 halalas plus the fixed charge of the breaker size', async () => {
      const w = await world();
      await approve(w, policyWith({ electricity: { breakerAmps: { } } }));
      await w.h.del(`/finance/bills/${(await w.h.get('/finance/bills')).body.data.bills[0].id}`);
      await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '3726.00', kwh: '12000' });
      expect((await report(w.h, w)).body.data.bill_check).toMatchObject({ level: 'OK', difference: '0.00' });

      // Feb 2027: 10,000 kWh -> 6,000 x 0.25 + 4,000 x 0.35 = 2,900.00 ; fixed 500 x 28/30 = 466.67 ; VAT 15% = 505.00 ; total 3,871.67
      await w.fin.put('/cost/policy/draft', { policy: policyWith({ electricity: { breakerAmps: { [w.riyadh]: 150 } } }) });
      await w.h.post('/cost/policy/approve');
      await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2027-02-01', period_end: '2027-02-28', amount: '3871.67', kwh: '10000' });
      const c = (await report(w.h, w, '2027-02')).body.data.bill_check;
      expect(c.tariff_id).toBe('SE-2027-COMMERCIAL');
      expect(c.estimate).toMatchObject({ energy: '2900.00', fixed: '466.67', vat: '505.00', total: '3871.67', warnings: [] });
      expect(c).toMatchObject({ level: 'OK', difference: '0.00' });
    });

    it('says so instead of guessing: a period across the tariff change, no kWh on the bill', async () => {
      const w = await world();
      await approve(w);
      await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2026-12-15', period_end: '2027-01-14', amount: '100.00', kwh: '500' });
      const straddle = (await report(w.h, w, '2026-12')).body.data.bill_check;
      expect([straddle.failure, straddle.estimate, straddle.level]).toEqual(['PERIOD_STRADDLES_TARIFF_CHANGE', null, null]);
      await w.h.post('/finance/bills', { branch_id: w.riyadh, period_start: '2026-11-01', period_end: '2026-11-30', amount: '100.00' });
      expect((await report(w.h, w, '2026-11')).body.data.bill_check.note).toMatch(/no kWh/);
    });

    it('publishes the tariff register with sources', async () => {
      const w = await world();
      const t = (await w.fin.get('/cost/tariffs')).body.data.tariffs as { id: string; source: string; fixed_charges: unknown }[];
      expect(t.find((x) => x.id === 'SE-2027-COMMERCIAL')).toMatchObject({ effective_from: '2027-01-01', tiers: [{ up_to_kwh: 6000, halalas_per_kwh: 25 }, { up_to_kwh: null, halalas_per_kwh: 35 }] });
      expect(t.find((x) => x.id === 'SE-2018-COMMERCIAL')?.fixed_charges).toBeNull();
      expect(t.every((x) => x.source.length > 10)).toBe(true);
    });
  });

  describe('access and isolation', () => {
    it('branch manager reports on their branch only; student affairs see nothing; another institute sees nothing', async () => {
      const w = await world();
      await approve(w);
      expect((await report(w.mgr, w)).status).toBe(200);
      expect((await w.mgr.get(`/cost/report?branch_id=${w.jeddah}&month=2026-09`)).status).toBe(404);
      expect((await report(w.aff, w)).status).toBe(403);
      expect((await w.aff.put('/cost/meter-readings', { room_id: w.r1, month: '2026-09', kwh: '1' })).status).toBe(403);
      expect((await w.mgr.put('/cost/meter-readings', { room_id: randomUUID(), month: '2026-09', kwh: '1' })).status).toBe(404);
      expect((await w.h.get('/cost/report?branch_id=nope&month=2026-09')).status).toBe(422);
      expect((await w.h.get(`/cost/report?branch_id=${w.riyadh}&month=2026-9`)).status).toBe(422);
      const other = hq(tenantB);
      expect((await other.get(`/cost/report?branch_id=${w.riyadh}&month=2026-09`)).status).toBe(404);
      expect((await other.get('/cost/policy')).body.data).toMatchObject({ approved: null, draft: null, history: [] });
    });
  });
});
