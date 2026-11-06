'use strict';
/**
 * Fills one academy with a demo institute (three branches, classrooms, assets, programmes, instructors, students, sessions with
 * attendance, electricity bills and sub-meter readings, expenses, budgets, invoices and payments, instructor payouts, an approved
 * cost policy) so every screen of the institute module can be tried.
 *
 * It goes through the application's own services (not straight into tables), so every rule applies: VAT, encrypted IDs, no double
 * booking, row-level security, audit trail. Refuses to run twice (it stops if the academy already has branches).
 *
 *   DIST=/path/to/dist node scripts/demo/seed-institute.cjs <academy-slug>
 *
 * Needs the API's environment (DATABASE_URL, FIELD_ENCRYPTION_KEY_BASE64, ...). The people in it are made-up demo records with
 * example.test e-mail addresses and obviously fake ID numbers.
 */
const path = require('node:path');

const DIST = process.env.DIST || path.resolve('dist');
const load = (p) => require(path.join(DIST, p));
const { prisma, withTenantTransaction, runWithBranchScope } = load('config/database');
const { env } = load('config/env');
const { FieldCipher } = load('shared/utils/crypto');
const { PrismaInstituteRepository } = load('modules/institute/institute.repository');
const { InstituteService } = load('modules/institute/institute.service');
const { PrismaAcademicRepository } = load('modules/institute/academic/academic.repository');
const { AcademicService } = load('modules/institute/academic/academic.service');
const { PrismaFinanceRepository } = load('modules/institute/finance/finance.repository');
const { FinanceService } = load('modules/institute/finance/finance.service');
const { PrismaCostRepository } = load('modules/institute/cost/cost.repository');
const { CostService } = load('modules/institute/cost/cost.service');
const { fromCents } = load('modules/institute/finance/finance.logic');

const slug = process.argv[2];
if (!slug) {
  console.log('usage: seed-institute.cjs <academy-slug>');
  process.exit(2);
}

// ------------------------------------------------------------------ the demo institute

const BRANCHES = [
  { key: 'riyadh', name: 'الرياض', city: 'الرياض', address: 'حي العليا، طريق الملك فهد' },
  { key: 'makkah', name: 'مكة المكرمة', city: 'مكة المكرمة', address: 'حي العزيزية' },
  { key: 'abha', name: 'أبها', city: 'أبها', address: 'حي المنهل' },
];

// [name, kind, area m2, capacity, power kW]
const ROOMS = {
  riyadh: [['معمل الحاسب 1', 'LAB', 80, 24, 12], ['فصل 101', 'CLASSROOM', 50, 25, 3], ['القاعة الكبرى', 'HALL', 150, 100, 8]],
  makkah: [['معمل اللغات', 'LAB', 60, 20, 6], ['فصل 201', 'CLASSROOM', 45, 22, 2.5], ['قاعة المحاضرات', 'HALL', 120, 80, 6]],
  abha: [['معمل الحاسب', 'LAB', 70, 20, 10], ['فصل 1', 'CLASSROOM', 40, 20, 2], ['فصل 2', 'CLASSROOM', 40, 20, 2]],
};

// [name, category, purchase date, value, life months, room index or null, retiredOn]
const ASSETS = {
  riyadh: [['أجهزة حاسب مكتبية (24)', 'تقنية', '2025-09-01', '72000.00', 48, 0], ['جهاز عرض', 'تقنية', '2026-01-10', '3500.00', 60, 1], ['مكيفات سبليت', 'تجهيزات', '2025-06-15', '18000.00', 120, 2], ['طابعة قديمة', 'تقنية', '2021-03-01', '2500.00', 60, null, '2026-08-20']],
  makkah: [['أجهزة سمعية للمعمل (20)', 'تقنية', '2025-11-01', '30000.00', 48, 0], ['سبورة ذكية', 'تقنية', '2026-02-15', '9500.00', 60, 1], ['مكيفات سبليت', 'تجهيزات', '2025-07-01', '14000.00', 120, 2]],
  abha: [['أجهزة حاسب مكتبية (20)', 'تقنية', '2025-10-01', '60000.00', 48, 0], ['جهاز عرض', 'تقنية', '2026-03-05', '3200.00', 60, 1]],
};

const INSTRUCTORS = {
  riyadh: [['د. سعد البقمي', '150.00', 'دكتوراه في الإدارة'], ['أ. منى العتيبي', '120.00', 'ماجستير تطوير موارد بشرية'], ['أ. خالد الشهري', '180.00', 'مدرب معتمد، 15 سنة خبرة']],
  makkah: [['أ. هدى الغامدي', '130.00', 'ماجستير لغويات تطبيقية'], ['أ. فيصل الحربي', '110.00', 'بكالوريوس لغة إنجليزية، IELTS']],
  abha: [['م. عبدالله القحطاني', '140.00', 'مهندس حاسب'], ['أ. ريم العسيري', '100.00', 'بكالوريوس نظم معلومات']],
};

// programmes: [name, fee, stateBorneVat, levels: [[name, [[subject, hours]]]]]
const PROGRAMMES = {
  riyadh: [
    ['دبلوم الإدارة والقيادة', '12000.00', true, [['المستوى الأول', [['مبادئ الإدارة', 30], ['مهارات القيادة', 30]]], ['المستوى الثاني', [['إدارة المشاريع', 35], ['الإدارة المالية', 30]]]]],
    ['دورة إعداد المدربين', '4500.00', false, [['المستوى الأول', [['تصميم البرامج التدريبية', 24]]]]],
  ],
  makkah: [['دبلوم اللغة الإنجليزية', '9000.00', true, [['المستوى الأول', [['القواعد والكتابة', 40], ['المحادثة والاستماع', 40]]]]]],
  abha: [['دبلوم الحاسب وتقنية المعلومات', '10500.00', true, [['المستوى الأول', [['أساسيات الحاسب', 36], ['مقدمة في الشبكات', 30]]]]]],
};

// weekly classes: [programme idx, level idx, subject idx, room idx, instructor idx, weekdays (0 = Sunday), slot]
const CLASSES = {
  riyadh: [[0, 0, 0, 1, 0, [0, 2], 0], [0, 1, 0, 0, 1, [1, 3], 0], [1, 0, 0, 2, 2, [0, 2], 1]],
  makkah: [[0, 0, 0, 0, 0, [0, 2], 0], [0, 0, 1, 1, 1, [1, 3], 0]],
  abha: [[0, 0, 0, 0, 0, [0, 2], 0], [0, 0, 1, 1, 1, [1, 3], 0]],
};
const SLOTS = [['09:00', '11:00'], ['11:30', '13:30'], ['16:00', '18:00']];

// students: [branch, programme idx, level idx, count]
const COHORTS = [['riyadh', 0, 0, 6], ['riyadh', 0, 1, 3], ['riyadh', 1, 0, 4], ['makkah', 0, 0, 8], ['abha', 0, 0, 7]];
const FIRST = ['محمد', 'عبدالله', 'فهد', 'سلمان', 'ناصر', 'تركي', 'يوسف', 'إبراهيم', 'سارة', 'نورة', 'ريم', 'هند', 'لمى', 'أمل', 'مشاعل', 'جواهر', 'عمر', 'بدر', 'ماجد', 'سعود', 'منيرة', 'العنود', 'رهف', 'وجدان', 'طلال', 'راكان', 'شهد', 'دانة'];
const FAMILY = ['العتيبي', 'القحطاني', 'الدوسري', 'الغامدي', 'الحربي', 'الشمري', 'الزهراني', 'المطيري', 'السبيعي', 'الشهري'];

// ------------------------------------------------------------------ helpers

const log = (s) => console.log(s);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.toISOString().slice(0, 10);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const at = (date, time) => new Date(`${date}T${time}:00+03:00`);

/** Working days (Sunday to Thursday) from `from` to `to` inclusive. */
function days(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push({ date: iso(d), dow: d.getUTCDay() });
  return out;
}

/** What a commercial bill at the 2018 tariff (22 / 32 halalas, 6,000 kWh threshold) plus 15% VAT comes to, in SAR with 2 decimals. */
function commercialBill(kwh) {
  const energy = Math.min(kwh, 6000) * 0.22 + Math.max(0, kwh - 6000) * 0.32;
  const vat = Math.round(energy * 15) / 100;
  return { amount: money(energy + vat), vat: money(vat) };
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, status: true, vatNumber: true, name: true } });
  if (!tenant) throw new Error(`academy "${slug}" not found`);
  const admin = await withTenantTransaction(tenant.id, (tx) => tx.user.findFirst({ where: { tenantId: tenant.id, role: 'TENANT_ADMIN' }, select: { id: true } }));
  if (!admin) throw new Error('the academy has no admin user');
  const existing = await withTenantTransaction(tenant.id, (tx) => tx.branch.count({ where: { tenantId: tenant.id } }));
  if (existing > 0) {
    log(`the academy already has ${existing} branch(es): not seeding again`);
    return;
  }

  const t = tenant.id;
  const caller = { userId: admin.id, userRole: 'TENANT_ADMIN', ip: null, vatRegistered: Boolean(tenant.vatNumber) };
  const instRepo = new PrismaInstituteRepository();
  const acadRepo = new PrismaAcademicRepository();
  const finRepo = new PrismaFinanceRepository();
  const inst = new InstituteService(instRepo);
  const acad = new AcademicService(acadRepo, inst, instRepo, new FieldCipher(env.FIELD_ENCRYPTION_KEY_BASE64));
  const fin = new FinanceService(finRepo, inst, instRepo, acadRepo);
  const cost = new CostService(new PrismaCostRepository(), inst, instRepo, acadRepo, finRepo);

  const n = { branches: 0, rooms: 0, assets: 0, programs: 0, instructors: 0, students: 0, sessions: 0, attendance: 0, invoices: 0, payments: 0, expenses: 0, bills: 0, readings: 0, payouts: 0 };
  const B = {}; // branch key -> { id, rooms: [...], programs: [...], instructors: [...], students: [...] }

  // ---- branches, rooms, assets, departments, staff
  for (const b of BRANCHES) {
    const branch = await inst.createBranch(t, caller, { name: b.name, city: b.city, address: b.address, active: true });
    n.branches++;
    const rooms = [];
    for (const [name, kind, area, capacity, kw] of ROOMS[b.key]) {
      rooms.push(await inst.createRoom(t, caller, { branchId: branch.id, name, kind, areaM2: money(area), capacity, powerKw: money(kw), active: true }));
      n.rooms++;
    }
    const assets = [];
    for (const [name, category, date, value, life, roomIdx, retiredOn] of ASSETS[b.key]) {
      assets.push(
        await inst.createAsset(t, caller, {
          branchId: branch.id, roomId: roomIdx === null ? null : rooms[roomIdx].id, name, category, serialNo: null, purchaseDate: date, retiredOn: retiredOn ?? null,
          purchaseValue: value, salvagePercent: '10.00', usefulLifeMonths: life, status: retiredOn ? 'RETIRED' : 'IN_SERVICE', notes: null,
        }),
      );
      n.assets++;
    }
    // maintenance history on the first asset: one routine service done, the next due soon (and one overdue on the second)
    await inst.logMaintenance(t, caller, assets[0].id, { performedOn: '2026-05-10', kind: 'SERVICE', cost: '450.00', notes: 'صيانة دورية', nextDueOn: '2026-11-20' });
    if (assets[1]) await inst.logMaintenance(t, caller, assets[1].id, { performedOn: '2026-03-01', kind: 'INSPECTION', cost: '0.00', notes: 'فحص', nextDueOn: '2026-09-01' });
    await inst.createDepartment(t, caller, { branchId: branch.id, name: 'الإدارة' });
    B[b.key] = { id: branch.id, rooms, assets, programs: [], instructors: [], students: [] };
  }
  await inst.createDepartment(t, caller, { branchId: null, name: 'الشؤون المالية' });
  const dept = (await inst.listDepartments(t, caller)).find((d) => d.name === 'الشؤون المالية');
  await inst.createStaff(t, caller, { branchId: B.riyadh.id, departmentId: dept.id, fullName: 'أ. بدر العنزي', jobTitle: 'محاسب', phone: '0500000101', email: 'demo.staff1@example.test', active: true });
  await inst.createStaff(t, caller, { branchId: B.makkah.id, departmentId: null, fullName: 'أ. نوف الجهني', jobTitle: 'منسقة شؤون الطلاب', phone: '0500000102', email: 'demo.staff2@example.test', active: true });
  log('branches, rooms, assets, maintenance, departments, staff: done');

  // ---- programmes, instructors
  for (const b of BRANCHES) {
    const branchId = B[b.key].id;
    for (const [name, fee, stateBorne, levels] of PROGRAMMES[b.key]) {
      const program = await acad.createProgram(t, caller, { branchId, name, description: null, admissionRequirements: 'شهادة الثانوية العامة', fee, active: true, stateBorneVat: stateBorne });
      const lv = [];
      for (const [i, [levelName, subjects]] of levels.entries()) {
        const level = await acad.addLevel(t, caller, program.id, { name: levelName, sortOrder: i + 1 });
        const subs = [];
        for (const [subject, hours] of subjects) subs.push(await acad.addSubject(t, caller, level.id, { name: subject, hours, fee: null }));
        lv.push({ id: level.id, subjects: subs });
      }
      B[b.key].programs.push({ id: program.id, name, fee, levels: lv });
      n.programs++;
    }
    for (const [name, rate, quals] of INSTRUCTORS[b.key]) {
      const i = await acad.createInstructor(t, caller, { branchId, userId: null, fullName: name, phone: '0500000200', email: null, qualifications: quals, hourlyRate: rate, active: true });
      B[b.key].instructors.push({ id: i.id, name, rate });
      n.instructors++;
    }
  }
  log('programmes, levels, subjects, instructors: done');

  // ---- students
  let seq = 0;
  for (const [key, p, l, count] of COHORTS) {
    const prog = B[key].programs[p];
    for (let i = 0; i < count; i++) {
      seq++;
      const saudi = seq % 10 < 7;
      const s = await acad.createStudent(t, caller, {
        branchId: B[key].id, programId: prog.id, levelId: prog.levels[l].id, userId: null,
        fullName: `${FIRST[seq % FIRST.length]} ${FAMILY[(seq * 3) % FAMILY.length]}`, phone: `05000003${pad(seq)}`, email: `demo.student${seq}@example.test`,
        status: 'ACTIVE', enrolledOn: '2026-09-01', citizenship: saudi ? 'SAUDI' : 'OTHER', nationalId: saudi ? `10000000${pad(seq)}` : `20000000${pad(seq)}`,
      });
      B[key].students.push({ id: s.id, programId: prog.id, levelId: prog.levels[l].id, fee: prog.fee, programName: prog.name, saudi });
      n.students++;
    }
  }
  log(`students: ${n.students}`);

  // ---- sessions (Sept-Oct held, a few upcoming), with attendance
  const term = days('2026-09-06', '2026-10-29');
  const upcoming = days('2026-11-09', '2026-11-19');
  const heldByClass = [];
  let attSeq = 0;
  for (const b of BRANCHES) {
    const bk = B[b.key];
    for (const [pi, li, si, ri, ii, wd, slot] of CLASSES[b.key]) {
      const prog = bk.programs[pi];
      const subject = prog.levels[li].subjects[si];
      const room = bk.rooms[ri];
      const instr = bk.instructors[ii];
      const [from, to] = SLOTS[slot];
      const cohort = bk.students.filter((s) => s.levelId === prog.levels[li].id);
      const make = async (date, status) => {
        const base = { roomId: room.id, instructorId: instr.id, startsAt: at(date, from), endsAt: at(date, to), notes: null };
        const s = await acad.scheduleSession(t, caller, { subjectId: subject.id, ...base });
        n.sessions++;
        if (status !== 'SCHEDULED') await acad.updateSession(t, caller, s.id, { ...base, status });
        return s;
      };
      let k = 0;
      for (const day of term.filter((d) => wd.includes(d.dow))) {
        k++;
        if (k === 5) {
          await make(day.date, 'CANCELLED'); // one cancelled session: it frees the slot and earns nothing
          continue;
        }
        const s = await make(day.date, 'HELD');
        heldByClass.push(s.id);
        // attendance: most present, a few late / absent, varying by session and student
        const rows = cohort.map((st, idx) => {
          attSeq++;
          const r = (attSeq + idx) % 11;
          return { studentId: st.id, status: r === 0 ? 'ABSENT' : r === 5 ? 'LATE' : r === 9 ? 'EXCUSED' : 'PRESENT' };
        });
        if (rows.length > 0) {
          await acad.recordAttendance(t, caller, s.id, rows);
          n.attendance += rows.length;
        }
      }
      for (const day of upcoming.filter((d) => wd.includes(d.dow))) await make(day.date, 'SCHEDULED');
    }
  }
  log(`sessions: ${n.sessions}, attendance marks: ${n.attendance}`);

  // ---- electricity: bills at the 2018 commercial tariff (+15% VAT), sub-meter readings, expenses, budgets
  const months = [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31']];
  const KWH = { riyadh: [14500, 13200], makkah: [9800, 9100], abha: [8600, 8000] };
  const EXTRA = { riyadh: [1, 1], makkah: [1.12, 1], abha: [1, 1] }; // Makkah's September bill is 12% above the tariff estimate: the check flags it
  let billOrder = 0;
  for (const b of BRANCHES) {
    const bk = B[b.key];
    for (const [mi, [start, end]] of months.entries()) {
      const kwh = KWH[b.key][mi];
      const est = commercialBill(kwh);
      const amount = money(Number(est.amount) * EXTRA[b.key][mi]);
      const vat = money(Number(est.vat) * EXTRA[b.key][mi]);
      await fin.recordBill(t, caller, { branchId: bk.id, periodStart: start, periodEnd: end, amount, kwh: money(kwh), vatAmount: vat });
      n.bills++;
      // sub-meters on the labs and the first classroom
      for (const [ri, share] of [[0, 0.38], [1, 0.12]]) {
        await cost.saveReading(t, caller, { roomId: bk.rooms[ri].id, month: start.slice(0, 7), kwh: money(kwh * share) });
        n.readings++;
      }
      const sc = b.key === 'riyadh' ? 1 : b.key === 'makkah' ? 0.8 : 0.65;
      const lines = [['نظافة', 2400 * sc, null], ['أمن وحراسة', 5000 * sc, null], ['مطبوعات وورقيات', 900 * sc, null], ['صيانة مكيفات', 1800 * sc, bk.rooms[0].id]];
      for (const [category, value, roomId] of lines) {
        await fin.recordExpense(t, caller, { branchId: bk.id, roomId, category, amount: money(value + mi * 120), incurredOn: `${start.slice(0, 8)}${pad(8 + billOrder % 7)}`, vendor: null, description: null });
        n.expenses++;
      }
      billOrder++;
      // budgets: a total, electricity, cleaning; some deliberately tight so the alerts show
      const tight = b.key === 'makkah' ? 0.9 : 1.4;
      const total = (2400 + 5000 + 900 + 1800) * sc + 120 * 4 * mi + Number(amount);
      await fin.saveBudget(t, caller, { id: '', branchId: bk.id, category: null, period: start, amount: money(total * tight), warnPercent: 80 });
      await fin.saveBudget(t, caller, { id: '', branchId: bk.id, category: 'ELECTRICITY', period: start, amount: money(Number(amount) * (b.key === 'abha' ? 0.95 : 1.1)), warnPercent: 80 });
      await fin.saveBudget(t, caller, { id: '', branchId: bk.id, category: 'نظافة', period: start, amount: money(2400 * sc * 1.05), warnPercent: 80 });
    }
  }
  log(`bills: ${n.bills}, readings: ${n.readings}, expenses: ${n.expenses}, budgets: done`);

  // ---- invoices (3 monthly instalments from 15 Sept) and payments: the first mostly paid, the second partly, so some are overdue
  let i = 0;
  for (const b of BRANCHES) {
    for (const st of B[b.key].students) {
      i++;
      const view = await fin.issueInvoice(t, caller, { studentId: st.id, description: `رسوم ${st.programName} — الفصل الأول`, amount: st.fee, discount: i % 5 === 0 ? '500.00' : '0.00', issuedOn: '2026-09-01', plan: { count: 3, firstDue: '2026-09-15' } });
      n.invoices++;
      const parts = view.installments;
      if (i % 4 !== 0) {
        await fin.receivePayment(t, caller, { invoiceId: view.invoice.id, amount: fromCents(parts[0].amountCents), paidOn: '2026-09-14', method: i % 2 ? 'TRANSFER' : 'CARD', reference: `DEMO-${i}-1` });
        n.payments++;
      }
      if (i % 4 === 1) {
        await fin.receivePayment(t, caller, { invoiceId: view.invoice.id, amount: fromCents(parts[1].amountCents), paidOn: '2026-10-14', method: 'TRANSFER', reference: `DEMO-${i}-2` });
        n.payments++;
      }
    }
  }
  log(`invoices: ${n.invoices}, payments: ${n.payments}`);

  // ---- instructor payouts: September paid for everyone who taught, October left (some partly) so the dues screen has both
  for (const b of BRANCHES) {
    for (const [idx, ins] of B[b.key].instructors.entries()) {
      try {
        await fin.recordPayout(t, caller, { instructorId: ins.id, month: '2026-09', paidOn: '2026-10-02', method: 'TRANSFER', reference: 'DEMO-SEP' });
        n.payouts++;
      } catch (e) {
        if (e.code !== 'NOTHING_DUE') throw e;
      }
      if (b.key === 'riyadh' && idx === 0) {
        await fin.recordPayout(t, caller, { instructorId: ins.id, month: '2026-10', amount: '500.00', paidOn: '2026-11-03', method: 'TRANSFER', reference: 'DEMO-OCT-PART' });
        n.payouts++;
      }
    }
  }
  log(`instructor payouts: ${n.payouts}`);

  // ---- cost policy: drafted by finance and approved by head office (a demo setting, not an accounting decision)
  const breakerAmps = Object.fromEntries(BRANCHES.map((b) => [B[b.key].id, 200]));
  await cost.saveDraft(
    t,
    caller,
    {
      electricity: { tariffCategory: 'COMMERCIAL', allocation: 'METER', vatRatePercent: 15, vatRegistered: Boolean(tenant.vatNumber), vatRecoveryPercent: tenant.vatNumber ? 100 : 0, breakerAmps },
      depreciation: { start: 'PURCHASE_MONTH', defaultLifeMonths: 60 },
      overhead: { basis: 'AREA' },
      occupancy: { availableHoursPerMonth: 176 },
      revenue: { basis: 'OVER_TIME' },
    },
    'سياسة تجريبية للعرض: يعتمدها المحاسب القانوني قبل الاستعمال الفعلي',
  );
  await cost.approveDraft(t, caller);
  log('cost policy: drafted and approved (demo)');

  console.log(JSON.stringify({ academy: tenant.name, vatRegistered: Boolean(tenant.vatNumber), created: n }));
}

runWithBranchScope(main)
  .catch((e) => {
    console.log('ERROR', e && e.code ? `${e.code}: ${e.message}` : String((e && e.stack) || e).slice(0, 1200));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
