/**
 * Institute finance through the HTTP API on a REAL PostgreSQL database: expenses, electricity bills, budgets and alerts,
 * student invoices / instalments / payments, instructor dues, closed months (locked by a database trigger).
 * Skipped when TEST_DATABASE_URL is unset. All dates are in the past so the tests do not depend on today's date.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, sign, tenants } from './helpers/test-app';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

type Db = typeof import('../../src/config/database');

describeDb('Institute finance API (real database)', () => {
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
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
  const hq = () => as(tokenOf(randomUUID(), 'TENANT_ADMIN'));

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
    /* eslint-enable @typescript-eslint/no-require-imports */
    const instRepo = new PrismaInstituteRepository();
    const acadRepo = new PrismaAcademicRepository();
    const instituteService = new InstituteService(instRepo);
    app = buildApp({
      instituteService,
      academicService: new AcademicService(acadRepo, instituteService, instRepo),
      financeService: new FinanceService(new PrismaFinanceRepository(), instituteService, instRepo, acadRepo),
    });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'FA', slug: `fa-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'FB', slug: `fb-${tenantB}`, status: 'ACTIVE' },
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
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.studentPayment.deleteMany({ where: { tenantId } });
      });
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.closedPeriod.deleteMany({ where: { tenantId } }); // reopen everything so the guarded tables can be cleaned
      });
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.invoiceInstallment.deleteMany({ where: { tenantId } });
        await tx.studentInvoice.deleteMany({ where: { tenantId } });
        await tx.expense.deleteMany({ where: { tenantId } });
        await tx.utilityBill.deleteMany({ where: { tenantId } });
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
        await tx.user.deleteMany({ where: { tenantId } });
      });
      delete tenants[tenantId];
    }
    await db.prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.prisma.$disconnect();
  });

  /** Two branches, a room in each, a student in Riyadh, and one person per role. */
  async function world() {
    const h = hq();
    const riyadh = (await h.post('/branches', { name: `R-${randomUUID().slice(0, 6)}` })).body.data.id as string;
    const jeddah = (await h.post('/branches', { name: `J-${randomUUID().slice(0, 6)}` })).body.data.id as string;
    const roomR = (await h.post('/rooms', { branch_id: riyadh, name: 'R1', area_m2: 50, capacity: 20 })).body.data.id as string;
    const roomJ = (await h.post('/rooms', { branch_id: jeddah, name: 'J1', area_m2: 50, capacity: 20 })).body.data.id as string;
    const studentR = (await h.post('/students', { branch_id: riyadh, full_name: 'سارة' })).body.data.id as string;
    const studentJ = (await h.post('/students', { branch_id: jeddah, full_name: 'نواف' })).body.data.id as string;
    await h.put('/members', { email: `${managerUser}@t.test`, role: 'BRANCH_MANAGER', branch_id: riyadh });
    await h.put('/members', { email: `${financeUser}@t.test`, role: 'FINANCE' });
    await h.put('/members', { email: `${affairsUser}@t.test`, role: 'STUDENT_AFFAIRS', branch_id: riyadh });
    return { h, riyadh, jeddah, roomR, roomJ, studentR, studentJ, mgr: as(tokenOf(managerUser, 'INSTRUCTOR')), fin: as(tokenOf(financeUser, 'INSTRUCTOR')), aff: as(tokenOf(affairsUser, 'INSTRUCTOR')) };
  }
  const F = '/finance';

  describe('expenses and electricity bills', () => {
    it('records expenses with exact amounts, filters them, and refuses invalid ones', async () => {
      const w = await world();
      const exp = (extra: object) => w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '120.50', incurred_on: '2026-09-10', ...extra });
      const a = await exp({});
      expect(a.status).toBe(201);
      expect(a.body.data).toMatchObject({ amount: '120.50', category: 'نظافة', incurred_on: '2026-09-10' });
      await exp({ category: 'أمن', amount: '300', incurred_on: '2026-10-02', room_id: w.roomR });
      expect((await w.h.get(`${F}/expenses?branch_id=${w.riyadh}&from=2026-10-01&to=2026-10-31`)).body.data.expenses.map((e: { category: string }) => e.category)).toEqual(['أمن']);
      expect((await w.h.get(`${F}/expenses?category=${encodeURIComponent('نظافة')}`)).body.data.expenses).toHaveLength(1);

      for (const bad of [{ amount: '0' }, { amount: '-5' }, { amount: '1.234' }, { amount: 'abc' }, { incurred_on: '2026-13-01' }, { category: '  ' }]) expect((await exp(bad)).status).toBe(422);
      const elec = await exp({ category: 'electricity' });
      expect([elec.status, elec.body.error.code]).toEqual([422, 'USE_UTILITY_BILL']);
      const cross = await exp({ room_id: w.roomJ });
      expect([cross.status, cross.body.error.code]).toEqual([422, 'ROOM_BRANCH_MISMATCH']);
      expect((await w.h.del(`${F}/expenses/${a.body.data.id}`)).status).toBe(204);
    });

    it('electricity bills are one per branch and month, with a valid period', async () => {
      const w = await world();
      const bill = (extra: object) => w.h.post(`${F}/bills`, { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '9000.00', kwh: '12000', ...extra });
      expect((await bill({})).status).toBe(201);
      expect((await bill({})).body.error.code).toBe('BILL_EXISTS');
      expect((await bill({ period_start: '2026-10-01', period_end: '2026-09-30' })).status).toBe(422);
      expect((await bill({ period_start: '2026-10-01', period_end: '2026-10-31', amount: '0' })).status).toBe(422);
      expect((await bill({ period_start: '2026-10-01', period_end: '2026-10-31', kwh: undefined })).status).toBe(201);
      expect((await w.h.get(`${F}/bills`)).body.data.bills).toHaveLength(2);
    });

    it('is closed to student affairs, scoped for a branch manager, open to finance across branches', async () => {
      const w = await world();
      expect((await w.aff.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'x', amount: '1', incurred_on: '2026-09-10' })).status).toBe(403);
      expect((await w.aff.get(`${F}/expenses`)).status).toBe(403);
      expect((await w.aff.get(`${F}/summary?month=2026-09`)).status).toBe(403);
      expect((await w.mgr.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'صيانة', amount: '50', incurred_on: '2026-09-10' })).status).toBe(201);
      expect((await w.mgr.post(`${F}/expenses`, { branch_id: w.jeddah, category: 'صيانة', amount: '50', incurred_on: '2026-09-10' })).status).toBe(404);
      expect((await w.fin.post(`${F}/expenses`, { branch_id: w.jeddah, category: 'صيانة', amount: '70', incurred_on: '2026-09-11' })).status).toBe(201);
      expect((await w.mgr.get(`${F}/expenses`)).body.data.expenses.every((e: { branch_id: string }) => e.branch_id === w.riyadh)).toBe(true);
      // finance spans the whole institute (this suite shares one tenant), so count only this world's branches
      expect((await w.fin.get(`${F}/expenses`)).body.data.expenses.filter((e: { branch_id: string }) => [w.riyadh, w.jeddah].includes(e.branch_id))).toHaveLength(2);
      const jid = (await w.h.get(`${F}/expenses?branch_id=${w.jeddah}`)).body.data.expenses[0].id as string;
      expect((await w.mgr.del(`${F}/expenses/${jid}`)).status).toBe(404);
    });
  });

  describe('budgets and alerts', () => {
    it('measures spending (expenses plus electricity bills) against category and total budgets with warning levels', async () => {
      const w = await world();
      await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '850.00', incurred_on: '2026-09-05' });
      await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'أمن', amount: '500.00', incurred_on: '2026-09-06' });
      await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '999.00', incurred_on: '2026-10-06' }); // another month
      await w.h.post(`${F}/bills`, { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '1500.00' });
      const save = (extra: object) => w.fin.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-09', amount: '1000', ...extra });
      expect((await save({ category: 'نظافة' })).status).toBe(200); // 850 of 1000 = 85%
      expect((await save({ category: 'أمن', amount: '400' })).status).toBe(200); // 500 of 400
      expect((await save({ category: 'ELECTRICITY', amount: '1500', warn_percent: 100 })).status).toBe(200); // exactly on budget
      expect((await save({ amount: '5000' })).status).toBe(200); // total: 850+500+1500 = 2850 of 5000
      const list = (await w.h.get(`${F}/budgets?month=2026-09&branch_id=${w.riyadh}`)).body.data.budgets as { category: string | null; spent: string; level: string; percent: number }[];
      const by = (c: string | null) => list.find((b) => b.category === c)!;
      expect(by('نظافة')).toMatchObject({ spent: '850.00', level: 'WARNING', percent: 85 });
      expect(by('أمن')).toMatchObject({ spent: '500.00', level: 'EXCEEDED' });
      expect(by('ELECTRICITY')).toMatchObject({ spent: '1500.00', level: 'WARNING' });
      expect(by(null)).toMatchObject({ spent: '2850.00', level: 'OK', percent: 57 });
      // saving again for the same scope replaces it instead of adding a second one
      await save({ category: 'نظافة', amount: '2000' });
      const again = (await w.h.get(`${F}/budgets?month=2026-09`)).body.data.budgets as { category: string | null; level: string }[];
      expect(again).toHaveLength(4);
      expect(again.find((b) => b.category === 'نظافة')?.level).toBe('OK');
      // another month has its own (empty) budgets and its own spending
      expect((await w.h.get(`${F}/budgets?month=2026-10`)).body.data.budgets).toEqual([]);
    });

    it('finance and head office set budgets; a branch manager only reads their own branch', async () => {
      const w = await world();
      expect((await w.mgr.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-09', amount: '100' })).status).toBe(403);
      await w.fin.put(`${F}/budgets`, { branch_id: w.jeddah, month: '2026-09', amount: '100' });
      await w.fin.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-09', amount: '100' });
      expect((await w.mgr.get(`${F}/budgets?month=2026-09`)).body.data.budgets.map((b: { branch_id: string }) => b.branch_id)).toEqual([w.riyadh]);
      expect((await w.fin.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-09', amount: '-1' })).status).toBe(422);
      expect((await w.fin.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-09', amount: '1', warn_percent: 0 })).status).toBe(422);
      expect((await w.fin.put(`${F}/budgets`, { branch_id: w.riyadh, month: '2026-13', amount: '1' })).status).toBe(422);
      const id = (await w.h.get(`${F}/budgets?month=2026-09&branch_id=${w.jeddah}`)).body.data.budgets[0].id as string;
      expect((await w.mgr.del(`${F}/budgets/${id}`)).status).toBe(403);
      expect((await w.fin.del(`${F}/budgets/${id}`)).status).toBe(204);
    });
  });

  describe('student invoices and payments', () => {
    const issue = (a: ReturnType<typeof as>, studentId: string, extra: object = {}) =>
      a.post(`${F}/invoices`, { student_id: studentId, description: 'رسوم الدبلوم', amount: '1000.00', discount: '0', issued_on: '2026-08-01', plan: { count: 3, first_due: '2026-08-15' }, ...extra });

    it('issues an invoice with an exact instalment plan and tracks what is paid, owed and overdue', async () => {
      const w = await world();
      const inv = await issue(w.h, w.studentR);
      expect(inv.status).toBe(201);
      expect(inv.body.data).toMatchObject({ net: '1000.00', paid: '0.00', outstanding: '1000.00', status: 'OPEN', overdue: true }); // all three are past due by now
      expect(inv.body.data.installments.map((i: { amount: string; due_on: string }) => [i.due_on, i.amount])).toEqual([['2026-08-15', '333.33'], ['2026-09-15', '333.33'], ['2026-10-15', '333.34']]);
      const id = inv.body.data.id as string;
      const pay = await w.fin.post(`${F}/invoices/${id}/payments`, { amount: '400.00', paid_on: '2026-08-20', method: 'TRANSFER', reference: 'TR-1' });
      expect(pay.status).toBe(201);
      const after = (await w.h.get(`${F}/invoices/${id}`)).body.data;
      expect(after).toMatchObject({ paid: '400.00', outstanding: '600.00' });
      expect(after.installments.map((i: { state: string; paid: string }) => [i.state, i.paid])).toEqual([['PAID', '333.33'], ['OVERDUE', '66.67'], ['OVERDUE', '0.00']]);
      expect((await w.h.get(`${F}/invoices?student_id=${w.studentR}`)).body.data.invoices).toHaveLength(1);
    });

    it('applies a discount, validates the plan, and keeps the invoice in the student branch', async () => {
      const w = await world();
      const ok = await issue(w.h, w.studentR, { discount: '100.00', plan: { count: 2, first_due: '2026-12-01' } });
      expect(ok.body.data).toMatchObject({ net: '900.00', overdue: false });
      expect(ok.body.data.installments.map((i: { amount: string }) => i.amount)).toEqual(['450.00', '450.00']);
      const code = async (extra: object) => {
        const r = await issue(w.h, w.studentR, extra);
        return [r.status, r.body.error?.code];
      };
      expect(await code({ discount: '1000.00' })).toEqual([422, 'DISCOUNT_TOO_LARGE']);
      expect(await code({ plan: undefined, installments: [{ due_on: '2026-09-01', amount: '400' }, { due_on: '2026-10-01', amount: '500' }] })).toEqual([422, 'INSTALLMENTS_MISMATCH']);
      expect((await issue(w.h, w.studentR, { plan: undefined, installments: [{ due_on: '2026-09-01', amount: '400' }, { due_on: '2026-10-01', amount: '600' }] })).status).toBe(201);
      expect((await issue(w.h, randomUUID())).status).toBe(404);
      expect((await issue(w.h, w.studentR, { amount: '0' })).status).toBe(422);
      expect((await issue(w.h, w.studentR, { plan: { count: 0, first_due: '2026-09-01' } })).status).toBe(422);
      // a branch manager invoices only their own branch's students
      expect((await issue(w.mgr, w.studentJ)).status).toBe(404);
      expect((await issue(w.mgr, w.studentR)).status).toBe(201);
      // student affairs have no access to the ledger
      expect((await issue(w.aff, w.studentR)).status).toBe(403);
    });

    it('never lets a payment exceed what is owed, including two simultaneous ones', async () => {
      const w = await world();
      const id = (await issue(w.h, w.studentR, { plan: { count: 1, first_due: '2026-12-01' } })).body.data.id as string;
      const pay = (amount: string, paid_on = '2026-09-01') => w.h.post(`${F}/invoices/${id}/payments`, { amount, paid_on });
      expect((await pay('1000.01')).status).toBe(409);
      const over = await pay('1000.01');
      expect([over.body.error.code, over.body.error.details.outstanding]).toEqual(['OVERPAID', '1000.00']);
      expect((await pay('300.00', '2999-01-01')).body.error.code).toBe('PAID_IN_FUTURE');
      expect((await pay('0')).status).toBe(422);
      // 700 + 700 against 1000 owed: the row lock serialises them, so exactly one wins
      const race = await Promise.all([pay('700.00'), pay('700.00')]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await w.h.get(`${F}/invoices/${id}`)).body.data).toMatchObject({ paid: '700.00', outstanding: '300.00' });
      expect((await pay('300.00')).status).toBe(201);
      expect((await w.h.get(`${F}/invoices/${id}`)).body.data).toMatchObject({ outstanding: '0.00', overdue: false });
      expect((await pay('0.01')).status).toBe(409);
    });

    it('payments are voided with a reason, not deleted; only head office or finance can void or cancel', async () => {
      const w = await world();
      const id = (await issue(w.h, w.studentR)).body.data.id as string;
      const p = (await w.mgr.post(`${F}/invoices/${id}/payments`, { amount: '500', paid_on: '2026-09-01' })).body.data.id as string;
      expect((await w.mgr.post(`${F}/payments/${p}/void`, { reason: 'خطأ في الإدخال' })).status).toBe(403);
      expect((await w.mgr.post(`${F}/invoices/${id}/cancel`)).status).toBe(403);
      expect((await w.fin.post(`${F}/payments/${p}/void`, { reason: '' })).status).toBe(422);
      expect((await w.fin.post(`${F}/invoices/${id}/cancel`)).body.error.code).toBe('INVOICE_HAS_PAYMENTS');
      const voided = await w.fin.post(`${F}/payments/${p}/void`, { reason: 'خطأ في الإدخال' });
      expect(voided.body.data).toMatchObject({ voided: true, void_reason: 'خطأ في الإدخال' });
      expect((await w.h.get(`${F}/invoices/${id}`)).body.data).toMatchObject({ paid: '0.00', outstanding: '1000.00' });
      expect((await w.h.get(`${F}/invoices/${id}`)).body.data.payments).toHaveLength(1); // still on record
      const cancelled = await w.fin.post(`${F}/invoices/${id}/cancel`);
      expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', outstanding: '0.00', overdue: false });
      expect((await w.h.post(`${F}/invoices/${id}/payments`, { amount: '10', paid_on: '2026-09-01' })).body.error.code).toBe('INVOICE_CANCELLED');
    });

    it('a student with invoices cannot be deleted', async () => {
      const w = await world();
      await issue(w.h, w.studentR);
      const r = await w.h.del(`/students/${w.studentR}`);
      expect([r.status, r.body.error.code]).toEqual([409, 'STUDENT_IN_USE']);
    });
  });

  describe('closing a month', () => {
    it('locks everything dated in it, in the service and in the database, until it is reopened', async () => {
      const w = await world();
      const invoice = (await w.h.post(`${F}/invoices`, { student_id: w.studentR, description: 'x', amount: '500', issued_on: '2026-08-01' })).body.data.id as string;
      const expense = (await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '100', incurred_on: '2026-09-10' })).body.data.id as string;
      const bill = (await w.h.post(`${F}/bills`, { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '900' })).body.data.id as string;
      const payment = (await w.h.post(`${F}/invoices/${invoice}/payments`, { amount: '200', paid_on: '2026-09-12' })).body.data.id as string;

      expect((await w.mgr.post(`${F}/closed-periods`, { branch_id: w.riyadh, month: '2026-09' })).status).toBe(403);
      const closed = await w.fin.post(`${F}/closed-periods`, { branch_id: w.riyadh, month: '2026-09' });
      expect(closed.status).toBe(201);
      expect(closed.body.data.period).toBe('2026-09-01');
      expect((await w.fin.post(`${F}/closed-periods`, { branch_id: w.riyadh, month: '2026-09' })).status).toBe(409);

      const locked = async (r: Promise<{ status: number; body: { error?: { code: string } } }>) => {
        const res = await r;
        return [res.status, res.body.error?.code];
      };
      const PERIOD = [409, 'PERIOD_CLOSED'];
      expect(await locked(w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'x', amount: '1', incurred_on: '2026-09-30' }))).toEqual(PERIOD);
      expect(await locked(w.h.del(`${F}/expenses/${expense}`))).toEqual(PERIOD);
      expect(await locked(w.h.del(`${F}/bills/${bill}`))).toEqual(PERIOD);
      expect(await locked(w.h.post(`${F}/bills`, { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '1' }))).toEqual([409, 'PERIOD_CLOSED']); // closed check wins over the duplicate
      expect(await locked(w.h.post(`${F}/invoices/${invoice}/payments`, { amount: '10', paid_on: '2026-09-20' }))).toEqual(PERIOD);
      expect(await locked(w.fin.post(`${F}/payments/${payment}/void`, { reason: 'تصحيح' }))).toEqual(PERIOD);

      // other months and the other branch are untouched
      expect((await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'x', amount: '1', incurred_on: '2026-10-01' })).status).toBe(201);
      expect((await w.h.post(`${F}/expenses`, { branch_id: w.jeddah, category: 'x', amount: '1', incurred_on: '2026-09-15' })).status).toBe(201);
      // a payment dated in an open month is fine even though the invoice was issued in an earlier one
      expect((await w.h.post(`${F}/invoices/${invoice}/payments`, { amount: '10', paid_on: '2026-10-05' })).status).toBe(201);

      // the DATABASE enforces it too: writing straight to the table, bypassing the API, is refused
      await expect(db.withTenantTransaction(tenantA, (tx) => tx.expense.create({ data: { tenantId: tenantA, branchId: w.riyadh, category: 'x', amount: '5', incurredOn: new Date('2026-09-05') } }))).rejects.toThrow(/institute_period_closed/);
      await expect(db.withTenantTransaction(tenantA, (tx) => tx.expense.update({ where: { id: expense }, data: { incurredOn: new Date('2026-10-05') } }))).rejects.toThrow(/institute_period_closed/); // moving one OUT of a closed month
      await expect(db.withTenantTransaction(tenantA, (tx) => tx.expense.create({ data: { tenantId: tenantA, branchId: w.riyadh, category: 'x', amount: '5', incurredOn: new Date('2026-10-05') } }))).resolves.toBeDefined();

      expect((await w.fin.get(`${F}/closed-periods`)).body.data.closed).toHaveLength(1);
      expect((await w.mgr.del(`${F}/closed-periods/${closed.body.data.id}`)).status).toBe(403);
      expect((await w.fin.del(`${F}/closed-periods/${closed.body.data.id}`)).status).toBe(204);
      expect((await w.h.del(`${F}/expenses/${expense}`)).status).toBe(204);
    });

    it('only a month that has ended can be closed', async () => {
      const w = await world();
      const now = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
      const r = await w.h.post(`${F}/closed-periods`, { branch_id: w.riyadh, month: now });
      expect([r.status, r.body.error.code]).toEqual([422, 'PERIOD_NOT_ENDED']);
      expect((await w.h.post(`${F}/closed-periods`, { branch_id: w.riyadh, month: '2999-01' })).body.error.code).toBe('PERIOD_NOT_ENDED');
      expect((await w.h.post(`${F}/closed-periods`, { branch_id: randomUUID(), month: '2026-08' })).status).toBe(404);
    });
  });

  describe('reports', () => {
    it('summarises income, spending and net per branch and in total', async () => {
      const w = await world();
      const inv = (await w.h.post(`${F}/invoices`, { student_id: w.studentR, description: 'x', amount: '2000', issued_on: '2026-08-01' })).body.data.id as string;
      await w.h.post(`${F}/invoices/${inv}/payments`, { amount: '1200.50', paid_on: '2026-09-03' });
      const voided = (await w.h.post(`${F}/invoices/${inv}/payments`, { amount: '100', paid_on: '2026-09-04' })).body.data.id as string;
      await w.h.post(`${F}/payments/${voided}/void`, { reason: 'تصحيح' });
      await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '200.25', incurred_on: '2026-09-05' });
      await w.h.post(`${F}/bills`, { branch_id: w.riyadh, period_start: '2026-09-01', period_end: '2026-09-30', amount: '800' });
      await w.h.post(`${F}/expenses`, { branch_id: w.jeddah, category: 'أمن', amount: '50', incurred_on: '2026-09-06' });
      await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'نظافة', amount: '999', incurred_on: '2026-10-05' }); // another month

      const s = (await w.fin.get(`${F}/summary?month=2026-09`)).body.data;
      const r = s.branches.find((b: { branch_id: string }) => b.branch_id === w.riyadh);
      expect(r).toMatchObject({ income: '1200.50', spend: '1000.25', net: '200.25', by_category: { 'نظافة': '200.25', ELECTRICITY: '800.00' }, closed: false });
      expect(s.branches.find((b: { branch_id: string }) => b.branch_id === w.jeddah)).toMatchObject({ income: '0.00', spend: '50.00', net: '-50.00' });
      const mine = s.branches.filter((b: { branch_id: string }) => [w.riyadh, w.jeddah].includes(b.branch_id));
      expect(mine.map((b: { net: string }) => b.net).sort()).toEqual(['-50.00', '200.25']);
      expect((await w.mgr.get(`${F}/summary?month=2026-09`)).body.data.branches.map((b: { branch_id: string }) => b.branch_id)).toEqual([w.riyadh]);
      expect((await w.h.get(`${F}/summary?month=2026-9`)).status).toBe(422);
    });

    it('instructor dues count only held sessions, by Saudi-time month, at the instructor hourly rate', async () => {
      const w = await world();
      const program = (await w.h.post('/programs', { branch_id: w.riyadh, name: 'دبلوم' })).body.data.id as string;
      const level = (await w.h.post(`/programs/${program}/levels`, { name: 'م1', sort_order: 1 })).body.data.id as string;
      const subject = (await w.h.post(`/levels/${level}/subjects`, { name: 'مادة', hours: 10 })).body.data.id as string;
      const instr = (await w.h.post('/instructors', { branch_id: w.riyadh, full_name: 'د. سعد', hourly_rate: '150.00' })).body.data.id as string;
      const session = async (from: string, to: string, status: 'HELD' | 'CANCELLED' | 'SCHEDULED') => {
        const created = await w.h.post('/sessions', { subject_id: subject, room_id: w.roomR, instructor_id: instr, starts_at: from, ends_at: to });
        expect(created.status).toBe(201);
        if (status !== 'SCHEDULED') expect((await w.h.put(`/sessions/${created.body.data.id}`, { room_id: w.roomR, instructor_id: instr, starts_at: from, ends_at: to, status })).status).toBe(200);
      };
      await session('2026-10-05T09:00:00+03:00', '2026-10-05T11:00:00+03:00', 'HELD'); // 120 min
      await session('2026-10-06T09:00:00+03:00', '2026-10-06T10:30:00+03:00', 'HELD'); // 90 min
      await session('2026-10-07T09:00:00+03:00', '2026-10-07T12:00:00+03:00', 'CANCELLED'); // earns nothing
      await session('2026-10-08T09:00:00+03:00', '2026-10-08T12:00:00+03:00', 'SCHEDULED'); // not held yet
      await session('2026-10-31T23:00:00+03:00', '2026-11-01T00:00:00+03:00', 'HELD'); // starts on 31 Oct (Saudi) = October, 60 min
      await session('2026-11-01T00:30:00+03:00', '2026-11-01T01:30:00+03:00', 'HELD'); // 1 Nov (Saudi) = November
      const oct = (await w.fin.get(`${F}/instructor-dues?month=2026-10`)).body.data;
      expect(oct.instructors).toEqual([expect.objectContaining({ name: 'د. سعد', minutes: 270, hourly_rate: '150.00', pay: '675.00' })]);
      expect(oct.total).toBe('675.00');
      expect((await w.fin.get(`${F}/instructor-dues?month=2026-11`)).body.data.instructors[0]).toMatchObject({ minutes: 60, pay: '150.00' });
      expect((await w.mgr.get(`${F}/instructor-dues?month=2026-10`)).body.data.total).toBe('675.00');
      expect((await w.aff.get(`${F}/instructor-dues?month=2026-10`)).status).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('another institute sees none of the books and cannot reach them by id', async () => {
      const w = await world();
      const exp = (await w.h.post(`${F}/expenses`, { branch_id: w.riyadh, category: 'x', amount: '5', incurred_on: '2026-09-10' })).body.data.id as string;
      const inv = (await w.h.post(`${F}/invoices`, { student_id: w.studentR, description: 'x', amount: '100', issued_on: '2026-09-01' })).body.data.id as string;
      const other = as(tokenOf(randomUUID(), 'TENANT_ADMIN', tenantB), tenantB);
      expect((await other.get(`${F}/expenses`)).body.data.expenses).toEqual([]);
      expect((await other.get(`${F}/invoices`)).body.data.invoices).toEqual([]);
      expect((await other.del(`${F}/expenses/${exp}`)).status).toBe(404);
      expect((await other.get(`${F}/invoices/${inv}`)).status).toBe(404);
      expect((await other.post(`${F}/invoices/${inv}/payments`, { amount: '1', paid_on: '2026-09-02' })).status).toBe(404);
      expect((await other.post(`${F}/invoices`, { student_id: w.studentR, description: 'x', amount: '1', issued_on: '2026-09-01' })).status).toBe(404);
    });
  });
});
