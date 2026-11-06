/**
 * VAT on student invoices (not registered / standard 15% / State-borne for Saudi citizens in qualifying programmes), the encrypted
 * national ID, and the ledger of instructor payouts, on a REAL PostgreSQL database. Skipped when TEST_DATABASE_URL is unset.
 * Dates are in the past so the tests do not depend on today's date.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, sign, tenants, testCipher } from './helpers/test-app';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

type Db = typeof import('../../src/config/database');
const CITIZEN_ID = '1012345678';
const REGISTERED = '300000000000003';

describeDb('Institute VAT on invoices and instructor payouts (real database)', () => {
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  const created: string[] = [];

  const as = (token: string, tenant: string) => ({
    get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object = {}) => request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    put: (p: string, body: object) => request(app).put(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    del: (p: string) => request(app).delete(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  });

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
      academicService: new AcademicService(acadRepo, instituteService, instRepo, testCipher),
      financeService: new FinanceService(finRepo, instituteService, instRepo, acadRepo),
      costService: new CostService(new PrismaCostRepository(), instituteService, instRepo, acadRepo, finRepo),
    });
  });

  afterAll(async () => {
    for (const tenantId of created) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.closedPeriod.deleteMany({ where: { tenantId } }); // reopen first: a closed month locks payouts and payments
      });
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.instructorPayout.deleteMany({ where: { tenantId } });
        await tx.studentPayment.deleteMany({ where: { tenantId } });
      });
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.invoiceInstallment.deleteMany({ where: { tenantId } });
        await tx.studentInvoice.deleteMany({ where: { tenantId } });
        await tx.expense.deleteMany({ where: { tenantId } });
        await tx.budget.deleteMany({ where: { tenantId } });
        await tx.attendance.deleteMany({ where: { tenantId } });
        await tx.classSession.deleteMany({ where: { tenantId } });
        await tx.student.deleteMany({ where: { tenantId } });
        await tx.instructor.deleteMany({ where: { tenantId } });
        await tx.subject.deleteMany({ where: { tenantId } });
        await tx.level.deleteMany({ where: { tenantId } });
        await tx.program.deleteMany({ where: { tenantId } });
        await tx.room.deleteMany({ where: { tenantId } });
        await tx.instituteMember.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
        await tx.auditLog.deleteMany({ where: { tenantId } });
        await tx.costPolicy.deleteMany({ where: { tenantId, status: 'DRAFT' } });
        await tx.user.deleteMany({ where: { tenantId } });
      });
      delete tenants[tenantId];
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: created } } });
    await db.prisma.$disconnect();
  });

  /**
   * A fresh institute. `vat` = registered (has a VAT number) or not. Riyadh, a lab room, two programmes (one qualifying for State-borne
   * VAT), an instructor at 150.00/h with two held sessions of 2 h in October 2026 (240 min = 600.00 due), and students.
   */
  async function world(vat = true) {
    const tenant = randomUUID();
    created.push(tenant);
    tenants[tenant] = { id: tenant, slug: `v-${tenant}`, name: 'V', status: 'ACTIVE', legalName: null, vatNumber: vat ? REGISTERED : null, brandSettings: {}, logoUpdatedAt: null, subscriptionEndsAt: null, features: { health: true, recorded: true, institute: true } };
    await db.prisma.tenant.create({ data: { id: tenant, name: 'V', slug: `v-${tenant}`, status: 'ACTIVE' } });
    const users = { manager: randomUUID(), finance: randomUUID(), affairs: randomUUID() };
    await db.withTenantTransaction(tenant, async (tx) => {
      for (const id of Object.values(users)) await tx.user.create({ data: { id, tenantId: tenant, email: `${id}@t.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
    });
    const h = as(sign({ sub: randomUUID(), tid: tenant, role: 'TENANT_ADMIN' }), tenant);
    const riyadh = (await h.post('/branches', { name: 'الرياض' })).body.data.id as string;
    const room = (await h.post('/rooms', { branch_id: riyadh, name: 'R1', area_m2: 50, capacity: 20, power_kw: 5 })).body.data.id as string;
    const prog = async (name: string, stateBorne: boolean) => {
      const id = (await h.post('/programs', { branch_id: riyadh, name, state_borne_vat: stateBorne })).body.data.id as string;
      const level = (await h.post(`/programs/${id}/levels`, { name: 'م1', sort_order: 1 })).body.data.id as string;
      const subject = (await h.post(`/levels/${level}/subjects`, { name: 'مادة', hours: 10 })).body.data.id as string;
      return { id, level, subject };
    };
    const qualifying = await prog('دبلوم معتمد', true);
    const plain = await prog('دورة قصيرة', false);
    const instr = (await h.post('/instructors', { branch_id: riyadh, full_name: 'د. سعد', hourly_rate: '150.00' })).body.data.id as string;
    const student = async (name: string, extra: object) => (await h.post('/students', { branch_id: riyadh, full_name: name, ...extra })).body.data;
    const citizen = await student('مواطنة', { citizenship: 'SAUDI', national_id: CITIZEN_ID, program_id: qualifying.id, level_id: qualifying.level });
    const expat = await student('مقيم', { citizenship: 'OTHER', program_id: qualifying.id, level_id: qualifying.level });
    const sessions: string[] = [];
    for (const day of [5, 6]) {
      const slot = { starts_at: `2026-10-0${day}T09:00:00+03:00`, ends_at: `2026-10-0${day}T11:00:00+03:00` };
      const s = await h.post('/sessions', { subject_id: qualifying.subject, room_id: room, instructor_id: instr, ...slot });
      expect(s.status).toBe(201);
      expect((await h.put(`/sessions/${s.body.data.id}`, { room_id: room, instructor_id: instr, ...slot, status: 'HELD' })).status).toBe(200);
      sessions.push(s.body.data.id);
    }
    await h.put('/members', { email: `${users.manager}@t.test`, role: 'BRANCH_MANAGER', branch_id: riyadh });
    await h.put('/members', { email: `${users.finance}@t.test`, role: 'FINANCE' });
    await h.put('/members', { email: `${users.affairs}@t.test`, role: 'STUDENT_AFFAIRS', branch_id: riyadh });
    const t = (u: string) => as(sign({ sub: u, tid: tenant, role: 'INSTRUCTOR' }), tenant);
    return { tenant, h, riyadh, room, qualifying, plain, instr, citizen, expat, mgr: t(users.manager), fin: t(users.finance), aff: t(users.affairs) };
  }
  const invoice = (a: ReturnType<typeof as>, studentId: string, extra: object = {}) =>
    a.post('/finance/invoices', { student_id: studentId, description: 'رسوم', amount: '1000.00', issued_on: '2026-10-01', ...extra });

  describe('the VAT an invoice carries', () => {
    it('an institute without a VAT number charges none', async () => {
      const w = await world(false);
      const r = await invoice(w.h, w.expat.id);
      expect(r.body.data).toMatchObject({ vat_treatment: 'NONE', vat: '0.00', net: '1000.00', total: '1000.00', outstanding: '1000.00' });
    });

    it('a registered institute charges 15% on the net after discount; the instalments add up to net + VAT', async () => {
      const w = await world();
      const r = await invoice(w.h, w.expat.id, { discount: '100.00', plan: { count: 3, first_due: '2026-10-15' } });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ vat_treatment: 'STANDARD', vat_rate_percent: 15, net: '900.00', vat: '135.00', total: '1035.00', outstanding: '1035.00', beneficiary_id_last4: null });
      expect(r.body.data.installments.map((i: { amount: string }) => i.amount)).toEqual(['345.00', '345.00', '345.00']);
      // odd halalas: 100.01 -> VAT 15.0015 rounds to 15.00 -> 115.01 in two instalments
      const odd = await invoice(w.h, w.expat.id, { amount: '100.01', plan: { count: 2, first_due: '2026-10-15' } });
      expect(odd.body.data).toMatchObject({ vat: '15.00', total: '115.01' });
      expect(odd.body.data.installments.map((i: { amount: string }) => i.amount)).toEqual(['57.50', '57.51']);
      // an explicit plan must add up to the TOTAL, not the net
      const wrong = await invoice(w.h, w.expat.id, { installments: [{ due_on: '2026-11-01', amount: '1000.00' }] });
      expect([wrong.status, wrong.body.error.code]).toEqual([422, 'INSTALLMENTS_MISMATCH']);
      expect((await invoice(w.h, w.expat.id, { installments: [{ due_on: '2026-11-01', amount: '1150.00' }] })).status).toBe(201);
    });

    it('payments settle the total including VAT, never more', async () => {
      const w = await world();
      const id = (await invoice(w.h, w.expat.id)).body.data.id as string;
      const pay = (amount: string) => w.h.post(`/finance/invoices/${id}/payments`, { amount, paid_on: '2026-10-10' });
      const over = await pay('1150.01');
      expect([over.status, over.body.error.code, over.body.error.details.outstanding]).toEqual([409, 'OVERPAID', '1150.00']);
      expect((await pay('1150.00')).status).toBe(201);
      expect((await w.h.get(`/finance/invoices/${id}`)).body.data).toMatchObject({ paid: '1150.00', outstanding: '0.00', overdue: false });
    });

    it('a Saudi citizen in a qualifying programme is charged no VAT (State-borne) and the invoice names the beneficiary', async () => {
      const w = await world();
      const r = await invoice(w.h, w.citizen.id);
      expect(r.body.data).toMatchObject({ vat_treatment: 'STATE_BORNE', vat: '0.00', net: '1000.00', total: '1000.00', beneficiary_id_last4: '5678' });
      expect(JSON.stringify(r.body)).not.toContain(CITIZEN_ID); // the ID never leaves the server
      // a citizen in a programme that does not qualify, or with no programme, pays the standard rate
      const nq = (await w.h.post('/students', { branch_id: w.riyadh, full_name: 'مواطن آخر', citizenship: 'SAUDI', national_id: '1098765432', program_id: w.plain.id, level_id: w.plain.level })).body.data;
      expect((await invoice(w.h, nq.id)).body.data).toMatchObject({ vat_treatment: 'STANDARD', vat: '150.00', total: '1150.00' });
      const none = (await w.h.post('/students', { branch_id: w.riyadh, full_name: 'بلا برنامج', citizenship: 'SAUDI', national_id: '1011111111' })).body.data;
      expect((await invoice(w.h, none.id)).body.data.vat_treatment).toBe('STANDARD');
    });

    it('a State-borne invoice cannot be issued without the national ID on record', async () => {
      const w = await world();
      const noId = (await w.h.post('/students', { branch_id: w.riyadh, full_name: 'بلا هوية', citizenship: 'SAUDI', program_id: w.qualifying.id, level_id: w.qualifying.level })).body.data;
      const r = await invoice(w.h, noId.id);
      expect([r.status, r.body.error.code]).toEqual([422, 'NATIONAL_ID_REQUIRED']);
      await w.h.put(`/students/${noId.id}`, { full_name: 'بلا هوية', citizenship: 'SAUDI', program_id: w.qualifying.id, level_id: w.qualifying.level, national_id: '1022222222' });
      expect((await invoice(w.h, noId.id)).body.data.vat_treatment).toBe('STATE_BORNE');
    });

    it('the VAT on an invoice is frozen when it is issued: changing the programme or student later does not touch it', async () => {
      const w = await world();
      const inv = (await invoice(w.h, w.citizen.id)).body.data.id as string;
      await w.h.put(`/programs/${w.qualifying.id}`, { name: 'دبلوم معتمد', state_borne_vat: false });
      await w.h.put(`/students/${w.citizen.id}`, { full_name: 'مواطنة', citizenship: 'OTHER', program_id: w.qualifying.id, level_id: w.qualifying.level });
      expect((await w.h.get(`/finance/invoices/${inv}`)).body.data).toMatchObject({ vat_treatment: 'STATE_BORNE', vat: '0.00', total: '1000.00' });
      expect((await invoice(w.h, w.citizen.id)).body.data).toMatchObject({ vat_treatment: 'STANDARD', vat: '150.00' }); // a new invoice follows the new facts
    });
  });

  describe('the national ID is stored sealed', () => {
    it('is validated, never returned, encrypted in the table, kept on edit and removable', async () => {
      const w = await world();
      const bad = async (extra: object) => (await w.h.post('/students', { branch_id: w.riyadh, full_name: 'س', ...extra })).status;
      expect(await bad({ citizenship: 'SAUDI', national_id: '2123456789' })).toBe(422); // a citizen's ID starts with 1
      expect(await bad({ citizenship: 'SAUDI', national_id: '12345' })).toBe(422);
      expect(await bad({ citizenship: 'SAUDI', national_id: 'abcdefghij' })).toBe(422);
      expect(await bad({ citizenship: 'OTHER', national_id: '2123456789' })).toBe(201); // a resident's ID starts with 2

      const shown = (await w.h.get(`/students?program_id=${w.qualifying.id}`)).body.data.students.find((s: { id: string }) => s.id === w.citizen.id);
      expect(shown).toMatchObject({ citizenship: 'SAUDI', has_national_id: true, national_id_last4: '5678' });
      expect(Object.keys(shown).some((k) => /national_id$|enc/i.test(k) && k !== 'has_national_id')).toBe(false);

      const row = await db.withTenantTransaction(w.tenant, (tx) => tx.student.findFirstOrThrow({ where: { id: w.citizen.id } }));
      expect(row.nationalIdEnc).toMatch(/^v1\./);
      expect(row.nationalIdEnc).not.toContain(CITIZEN_ID);
      expect(testCipher.decrypt(row.nationalIdEnc!).toString('utf8')).toBe(CITIZEN_ID);
      expect(row.nationalIdLast4).toBe('5678');

      // editing without the field keeps it; the invoice keeps its own sealed copy
      const inv = (await invoice(w.h, w.citizen.id)).body.data.id as string;
      await w.h.put(`/students/${w.citizen.id}`, { full_name: 'مواطنة (معدّل)', citizenship: 'SAUDI', program_id: w.qualifying.id, level_id: w.qualifying.level });
      expect((await w.h.get('/students')).body.data.students.find((s: { id: string }) => s.id === w.citizen.id)).toMatchObject({ has_national_id: true });
      const copy = await db.withTenantTransaction(w.tenant, (tx) => tx.studentInvoice.findFirstOrThrow({ where: { id: inv } }));
      expect(testCipher.decrypt(copy.beneficiaryIdEnc!).toString('utf8')).toBe(CITIZEN_ID);
      // removing it: explicit null
      await w.h.put(`/students/${w.citizen.id}`, { full_name: 'مواطنة', citizenship: 'SAUDI', national_id: null });
      expect((await w.h.get('/students')).body.data.students.find((s: { id: string }) => s.id === w.citizen.id)).toMatchObject({ has_national_id: false, national_id_last4: null });
      expect((await db.withTenantTransaction(w.tenant, (tx) => tx.studentInvoice.findFirstOrThrow({ where: { id: inv } }))).beneficiaryIdEnc).toBeTruthy(); // the issued invoice is unaffected
    });

    it('the database refuses a State-borne invoice with VAT or without a beneficiary, and half-set IDs', async () => {
      const w = await world();
      const sid = w.expat.id;
      const raw = (data: object) => db.withTenantTransaction(w.tenant, (tx) => tx.studentInvoice.create({ data: { tenantId: w.tenant, branchId: w.riyadh, studentId: sid, description: 'x', amount: '100', issuedOn: new Date('2026-10-01'), ...data } as never }));
      await expect(raw({ vatTreatment: 'STATE_BORNE', beneficiaryIdEnc: null })).rejects.toThrow();
      await expect(raw({ vatTreatment: 'STATE_BORNE', beneficiaryIdEnc: 'v1.x.y.z', vatAmount: '15' })).rejects.toThrow();
      await expect(raw({ vatTreatment: 'STANDARD', vatRateBp: 0 })).rejects.toThrow();
      await expect(raw({ vatTreatment: 'NONE', vatAmount: '5' })).rejects.toThrow();
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.student.update({ where: { id: sid }, data: { nationalIdEnc: 'v1.a.b.c' } }))).rejects.toThrow(); // enc without last4
    });
  });

  describe('VAT summary for the return', () => {
    it('separates standard-rated supplies from State-borne ones and ignores cancelled invoices', async () => {
      const w = await world();
      await invoice(w.h, w.expat.id, { discount: '100.00' }); // net 900, VAT 135
      await invoice(w.h, w.expat.id, { amount: '200.00' }); // net 200, VAT 30
      await invoice(w.h, w.citizen.id, { amount: '500.00' }); // State-borne, net 500
      const gone = (await invoice(w.h, w.expat.id, { amount: '9999.00' })).body.data.id as string;
      await w.fin.post(`/finance/invoices/${gone}/cancel`);
      await invoice(w.h, w.expat.id, { issued_on: '2026-09-15' }); // another month
      const s = (await w.fin.get('/finance/vat-summary?month=2026-10')).body.data.rows as { treatment: string; invoices: number; net_amount: string; vat_amount: string }[];
      expect(s.find((r) => r.treatment === 'STANDARD')).toMatchObject({ invoices: 2, net_amount: '1100.00', vat_amount: '165.00' });
      expect(s.find((r) => r.treatment === 'STATE_BORNE')).toMatchObject({ invoices: 1, net_amount: '500.00', vat_amount: '0.00' });
      expect((await w.aff.get('/finance/vat-summary?month=2026-10')).status).toBe(403);
      expect((await w.mgr.get('/finance/vat-summary?month=2026-10')).status).toBe(200);
      expect((await w.h.get('/finance/vat-summary?month=2026-1')).status).toBe(422);
    });

    it('programme revenue in the cost report is net of VAT (collected VAT is owed to the Authority, not earned)', async () => {
      const w = await world();
      const inv = (await invoice(w.h, w.expat.id)).body.data.id as string; // net 1000, VAT 150, total 1150
      await w.h.post(`/finance/invoices/${inv}/payments`, { amount: '575.00', paid_on: '2026-10-12' }); // half of the 1,150.00
      const policy = {
        electricity: { tariffCategory: 'COMMERCIAL', allocation: 'AREA', vatRatePercent: 15, vatRegistered: true, vatRecoveryPercent: 100, breakerAmps: {} },
        depreciation: { start: 'PURCHASE_MONTH', defaultLifeMonths: 60 },
        overhead: { basis: 'AREA' },
        occupancy: { availableHoursPerMonth: 176 },
        revenue: { basis: 'CASH' },
      };
      expect((await w.fin.put('/cost/policy/draft', { policy })).status).toBe(200);
      expect((await w.h.post('/cost/policy/approve')).status).toBe(200);
      const r = (await w.h.get(`/cost/report?branch_id=${w.riyadh}&month=2026-10`)).body.data;
      const p = r.programs.find((x: { name: string }) => x.name === 'دبلوم معتمد');
      expect(p.revenue).toBe('500.00'); // 575.00 collected x 1000 / 1150 = 500.00 earned
    });
  });

  describe('paying instructors', () => {
    it('shows the dues, pays them in full by default, and refuses to pay twice', async () => {
      const w = await world();
      const dues = (await w.fin.get('/finance/instructor-dues?month=2026-10')).body.data;
      expect(dues).toMatchObject({ total: '600.00', paid: '0.00', outstanding: '600.00' }); // 4 h x 150.00
      const pay = await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2026-10-31', method: 'TRANSFER', reference: 'TR-77' });
      expect(pay.status).toBe(201);
      expect(pay.body.data).toMatchObject({ amount: '600.00', dues: '600.00', minutes: 240, hourly_rate: '150.00', method: 'TRANSFER', reference: 'TR-77', voided: false });
      const after = (await w.h.get('/finance/instructor-dues?month=2026-10')).body.data;
      expect(after).toMatchObject({ paid: '600.00', outstanding: '0.00' });
      expect(after.instructors[0]).toMatchObject({ pay: '600.00', paid: '600.00', outstanding: '0.00' });
      expect(after.payouts).toHaveLength(1);
      const again = await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2026-10-31' });
      expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_PAID']);
    });

    it('allows part payments but never more than is owed, even for simultaneous payouts', async () => {
      const w = await world();
      const pay = (amount: string) => w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', amount, paid_on: '2026-10-31' });
      const over = await pay('600.01');
      expect([over.status, over.body.error.code, over.body.error.details.outstanding]).toEqual([409, 'OVERPAID', '600.00']);
      expect((await pay('200.00')).status).toBe(201);
      expect((await w.h.get('/finance/instructor-dues?month=2026-10')).body.data.instructors[0]).toMatchObject({ paid: '200.00', outstanding: '400.00' });
      // 300 + 300 against the 400 still owed: the instructor row is locked, so exactly one wins
      const race = await Promise.all([pay('300.00'), pay('300.00')]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await pay('100.01')).status).toBe(409);
      expect((await pay('100.00')).status).toBe(201);
      expect((await pay('0.01')).status).toBe(409);
      expect((await pay('0')).status).toBe(422);
    });

    it('a payout is voided with a reason (and frees the amount), not deleted; roles are enforced', async () => {
      const w = await world();
      const p = (await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2026-10-31' })).body.data.id as string;
      expect((await w.mgr.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2026-10-31' })).status).toBe(403); // a branch manager sees dues but does not pay
      expect((await w.aff.get('/finance/instructor-dues?month=2026-10')).status).toBe(403);
      expect((await w.mgr.get('/finance/instructor-dues?month=2026-10')).status).toBe(200);
      expect((await w.mgr.post(`/finance/payouts/${p}/void`, { reason: 'خطأ في الإدخال' })).status).toBe(403);
      expect((await w.fin.post(`/finance/payouts/${p}/void`, { reason: '' })).status).toBe(422);
      const v = await w.fin.post(`/finance/payouts/${p}/void`, { reason: 'خطأ في الإدخال' });
      expect(v.body.data).toMatchObject({ voided: true, void_reason: 'خطأ في الإدخال' });
      const dues = (await w.h.get('/finance/instructor-dues?month=2026-10')).body.data;
      expect(dues).toMatchObject({ paid: '0.00', outstanding: '600.00' });
      expect(dues.payouts).toHaveLength(1); // still on record
      expect((await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2026-10-31' })).status).toBe(201); // can be paid again
      // an instructor with payouts cannot be deleted
      expect((await w.h.del(`/instructors/${w.instr}`)).status).toBe(409);
    });

    it('only for a month that has ended, not dated in the future, and only when something is due', async () => {
      const w = await world();
      const now = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
      const cur = await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: now, paid_on: '2026-10-31' });
      expect([cur.status, cur.body.error.code]).toEqual([422, 'PERIOD_NOT_ENDED']);
      expect((await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', paid_on: '2999-01-01' })).body.error.code).toBe('PAID_IN_FUTURE');
      const none = await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-08', paid_on: '2026-10-31' });
      expect([none.status, none.body.error.code]).toEqual([422, 'NOTHING_DUE']);
      expect((await w.fin.post('/finance/payouts', { instructor_id: randomUUID(), month: '2026-10', paid_on: '2026-10-31' })).status).toBe(404);
    });

    it('counts as spending in the month it is paid (summary and budgets), and respects a closed month in the service and the database', async () => {
      const w = await world();
      await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', amount: '250.00', paid_on: '2026-10-31' });
      const s = (await w.fin.get('/finance/summary?month=2026-10')).body.data.branches[0];
      expect(s).toMatchObject({ spend: '250.00', by_category: { INSTRUCTOR_PAY: '250.00' } });
      expect((await w.fin.put('/finance/budgets', { branch_id: w.riyadh, month: '2026-10', category: 'INSTRUCTOR_PAY', amount: '200.00' })).status).toBe(200);
      expect((await w.h.get('/finance/budgets?month=2026-10')).body.data.budgets[0]).toMatchObject({ category: 'INSTRUCTOR_PAY', spent: '250.00', level: 'EXCEEDED' });

      expect((await w.fin.post('/finance/closed-periods', { branch_id: w.riyadh, month: '2026-10' })).status).toBe(201);
      const locked = await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', amount: '100.00', paid_on: '2026-10-31' });
      expect([locked.status, locked.body.error.code]).toEqual([409, 'PERIOD_CLOSED']);
      await expect(db.withTenantTransaction(w.tenant, (tx) => tx.instructorPayout.create({ data: { tenantId: w.tenant, branchId: w.riyadh, instructorId: w.instr, period: new Date('2026-10-01'), amount: '1', duesAmount: '600', minutes: 240, hourlyRate: '150', paidOn: new Date('2026-10-31') } }))).rejects.toThrow(/institute_period_closed/);
      // paid in November for October work is fine (the month the cash moves is open)
      expect((await w.fin.post('/finance/payouts', { instructor_id: w.instr, month: '2026-10', amount: '100.00', paid_on: '2026-11-02' })).status).toBe(201);
    });
  });

  describe('isolation', () => {
    it('another institute sees none of it', async () => {
      const a = await world();
      const b = await world();
      await a.fin.post('/finance/payouts', { instructor_id: a.instr, month: '2026-10', paid_on: '2026-10-31' });
      expect((await b.h.get('/finance/instructor-dues?month=2026-10')).body.data.payouts).toEqual([]);
      expect((await b.h.post('/finance/payouts', { instructor_id: a.instr, month: '2026-10', paid_on: '2026-10-31' })).status).toBe(404);
      expect((await b.h.post('/finance/invoices', { student_id: a.expat.id, description: 'x', amount: '1', issued_on: '2026-10-01' })).status).toBe(404);
    });
  });
});
