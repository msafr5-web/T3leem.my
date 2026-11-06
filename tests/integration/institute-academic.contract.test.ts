/**
 * Institute academic side (programs, instructors, students, sessions, attendance) through the HTTP API
 * on top of a REAL PostgreSQL database, so double-booking protection is proven by the database itself.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, sign, tenants, testCipher } from './helpers/test-app';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

type Db = typeof import('../../src/config/database');
const SLOT = (day: number, from: string, to: string) => ({ starts_at: `2026-11-${String(day).padStart(2, '0')}T${from}:00+03:00`, ends_at: `2026-11-${String(day).padStart(2, '0')}T${to}:00+03:00` });

describeDb('Institute academic API (real database)', () => {
  let db: Db;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let app: ReturnType<typeof buildApp>;

  const as = (token: string, tenant = tenantA) => ({
    get: (p: string) => request(app).get(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object) => request(app).post(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    put: (p: string, body: object) => request(app).put(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`).send(body),
    del: (p: string) => request(app).delete(`/api/v1/admin/institute${p}`).set('x-tenant-id', tenant).set('Authorization', `Bearer ${token}`),
  });
  const tokenOf = (userId: string, role: string, tenant = tenantA) => sign({ sub: userId, tid: tenant, role });

  const hqToken = tokenOf(randomUUID(), 'TENANT_ADMIN');
  const managerUser = randomUUID();
  const affairsUser = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../../src/config/database') as Db;
    const { PrismaInstituteRepository } = require('../../src/modules/institute/institute.repository') as typeof import('../../src/modules/institute/institute.repository'); // eslint-disable-line @typescript-eslint/no-require-imports
    const { InstituteService } = require('../../src/modules/institute/institute.service') as typeof import('../../src/modules/institute/institute.service'); // eslint-disable-line @typescript-eslint/no-require-imports
    const { PrismaAcademicRepository } = require('../../src/modules/institute/academic/academic.repository') as typeof import('../../src/modules/institute/academic/academic.repository'); // eslint-disable-line @typescript-eslint/no-require-imports
    const { AcademicService } = require('../../src/modules/institute/academic/academic.service') as typeof import('../../src/modules/institute/academic/academic.service'); // eslint-disable-line @typescript-eslint/no-require-imports
    const instRepo = new PrismaInstituteRepository();
    const instituteService = new InstituteService(instRepo);
    app = buildApp({ instituteService, academicService: new AcademicService(new PrismaAcademicRepository(), instituteService, instRepo, testCipher) });

    await db.prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'IA', slug: `iaa-${tenantA}`, status: 'ACTIVE' },
        { id: tenantB, name: 'IB', slug: `iab-${tenantB}`, status: 'ACTIVE' },
      ],
    });
    for (const id of [tenantA, tenantB]) {
      tenants[id] = { id, slug: `x-${id}`, name: 'T', status: 'ACTIVE', legalName: null, vatNumber: null, brandSettings: {}, logoUpdatedAt: null, subscriptionEndsAt: null, features: { health: true, recorded: true, institute: true } };
    }
    await db.withTenantTransaction(tenantA, async (tx) => {
      for (const [id, role] of [[managerUser, 'INSTRUCTOR'], [affairsUser, 'INSTRUCTOR']] as const) {
        await tx.user.create({ data: { id, tenantId: tenantA, email: `${id}@t.test`, passwordHash: 'x', role } });
      }
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.withTenantTransaction(tenantId, async (tx) => {
        await tx.attendance.deleteMany({ where: { tenantId } });
        await tx.classSession.deleteMany({ where: { tenantId } });
        await tx.student.deleteMany({ where: { tenantId } });
        await tx.instructor.deleteMany({ where: { tenantId } });
        await tx.subject.deleteMany({ where: { tenantId } });
        await tx.level.deleteMany({ where: { tenantId } });
        await tx.program.deleteMany({ where: { tenantId } });
        await tx.asset.deleteMany({ where: { tenantId } });
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

  /** One institute: Riyadh and Jeddah, a program with two levels in Riyadh, two rooms, two instructors, students. */
  async function world() {
    const hq = as(hqToken);
    // An account can be linked to one instructor only, so each world gets its own two.
    const instructorUserA = randomUUID();
    const instructorUserB = randomUUID();
    await db.withTenantTransaction(tenantA, async (tx) => {
      for (const id of [instructorUserA, instructorUserB]) await tx.user.create({ data: { id, tenantId: tenantA, email: `${id}@t.test`, passwordHash: 'x', role: 'INSTRUCTOR' } });
    });
    const riyadh = (await hq.post('/branches', { name: `R-${randomUUID().slice(0, 6)}` })).body.data.id as string;
    const jeddah = (await hq.post('/branches', { name: `J-${randomUUID().slice(0, 6)}` })).body.data.id as string;
    const room = async (branch: string, name: string, capacity = 20) => (await hq.post('/rooms', { branch_id: branch, name, area_m2: 50, capacity, power_kw: 3 })).body.data.id as string;
    const roomR1 = await room(riyadh, 'R1');
    const roomR2 = await room(riyadh, 'R2');
    const roomJ = await room(jeddah, 'J1');
    const program = (await hq.post('/programs', { branch_id: riyadh, name: 'دبلوم الإدارة', fee: '12000.00', admission_requirements: 'ثانوية' })).body.data.id as string;
    const level1 = (await hq.post(`/programs/${program}/levels`, { name: 'المستوى 1', sort_order: 1 })).body.data.id as string;
    const level2 = (await hq.post(`/programs/${program}/levels`, { name: 'المستوى 2', sort_order: 2 })).body.data.id as string;
    const subject = (await hq.post(`/levels/${level1}/subjects`, { name: 'مبادئ الإدارة', hours: 40, fee: '800.00' })).body.data.id as string;
    const subject2 = (await hq.post(`/levels/${level2}/subjects`, { name: 'القيادة', hours: 30 })).body.data.id as string;
    const instrA = (await hq.post('/instructors', { branch_id: riyadh, full_name: 'د. سعد', hourly_rate: '150.00', user_id: instructorUserA })).body.data.id as string;
    const instrB = (await hq.post('/instructors', { branch_id: riyadh, full_name: 'أ. منى', hourly_rate: '120.00', user_id: instructorUserB })).body.data.id as string;
    const instrJ = (await hq.post('/instructors', { branch_id: jeddah, full_name: 'أ. فهد' })).body.data.id as string;
    return { instructorUserA, instructorUserB, hq, riyadh, jeddah, roomR1, roomR2, roomJ, program, level1, level2, subject, subject2, instrA, instrB, instrJ };
  }
  const schedule = (a: ReturnType<typeof as>, w: Awaited<ReturnType<typeof world>>, over: object = {}) =>
    a.post('/sessions', { subject_id: w.subject, room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '11:00'), ...over });

  describe('programs, levels, subjects', () => {
    it('builds the tree and keeps level order unique', async () => {
      const w = await world();
      const list = (await w.hq.get(`/programs?branch_id=${w.riyadh}`)).body.data.programs;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: 'دبلوم الإدارة', fee: '12000.00', admission_requirements: 'ثانوية' });
      expect(list[0].levels.map((l: { name: string }) => l.name)).toEqual(['المستوى 1', 'المستوى 2']);
      expect(list[0].levels[0].subjects[0]).toMatchObject({ name: 'مبادئ الإدارة', hours: 40, fee: '800.00' });
      expect((await w.hq.post(`/programs/${w.program}/levels`, { name: 'مكرر', sort_order: 1 })).status).toBe(409);
      expect((await w.hq.post('/programs', { branch_id: w.riyadh, name: 'دبلوم الإدارة' })).status).toBe(409);
      expect((await w.hq.post(`/levels/${w.level1}/subjects`, { name: 'x', hours: 0 })).status).toBe(422);
      expect((await w.hq.post('/programs', { branch_id: w.riyadh, name: 'س', fee: '-1' })).status).toBe(422);
    });

    it('refuses to delete a program with students or a subject with sessions', async () => {
      const w = await world();
      await w.hq.post('/students', { branch_id: w.riyadh, full_name: 'سارة', program_id: w.program, level_id: w.level1 });
      expect((await w.hq.del(`/programs/${w.program}`)).status).toBe(409);
      expect((await schedule(w.hq, w)).status).toBe(201);
      expect((await w.hq.del(`/subjects/${w.subject}`)).status).toBe(409);
      expect((await w.hq.del(`/levels/${w.level1}`)).status).toBe(409);
      // the same database rule protects rooms, instructors and rooms holding assets (a delete must be 409, never a 500)
      expect((await w.hq.del(`/rooms/${w.roomR1}`)).status).toBe(409);
      expect((await w.hq.del(`/instructors/${w.instrA}`)).status).toBe(409);
      await w.hq.post('/assets', { branch_id: w.riyadh, room_id: w.roomR2, name: 'جهاز' });
      expect((await w.hq.del(`/rooms/${w.roomR2}`)).status).toBe(409);
    });
  });

  describe('students', () => {
    it('keeps the program and level in the student branch and consistent with each other', async () => {
      const w = await world();
      const bad = async (extra: object, code: string) => {
        const r = await w.hq.post('/students', { branch_id: w.riyadh, full_name: 'ع', ...extra });
        expect([r.status, r.body.error?.code]).toEqual([422, code]);
      };
      await bad({ level_id: w.level1 }, 'LEVEL_NEEDS_PROGRAM');
      await bad({ branch_id: w.jeddah, program_id: w.program }, 'PROGRAM_BRANCH_MISMATCH');
      const other = (await w.hq.post('/programs', { branch_id: w.riyadh, name: 'دبلوم آخر' })).body.data.id as string;
      const otherLevel = (await w.hq.post(`/programs/${other}/levels`, { name: 'م1', sort_order: 1 })).body.data.id as string;
      await bad({ program_id: w.program, level_id: otherLevel }, 'LEVEL_PROGRAM_MISMATCH');
      const ok = await w.hq.post('/students', { branch_id: w.riyadh, full_name: 'سارة', program_id: w.program, level_id: w.level2, enrolled_on: '2026-09-01', email: 's@x.test' });
      expect(ok.status).toBe(201);
      const moved = await w.hq.put(`/students/${ok.body.data.id}`, { full_name: 'سارة', branch_id: w.jeddah, program_id: w.program, level_id: w.level1, status: 'SUSPENDED' });
      expect(moved.body.data).toMatchObject({ branch_id: w.riyadh, level_id: w.level1, status: 'SUSPENDED' }); // never changes branch on edit
      expect((await w.hq.get(`/students?status=SUSPENDED`)).body.data.students.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sessions: the database prevents double-booking', () => {
    it('rejects the same room or the same instructor at an overlapping time, and allows back-to-back sessions', async () => {
      const w = await world();
      expect((await schedule(w.hq, w)).status).toBe(201); // 09:00-11:00, R1, instrA
      const roomClash = await schedule(w.hq, w, { instructor_id: w.instrB, ...SLOT(10, '10:00', '12:00') });
      expect([roomClash.status, roomClash.body.error.code]).toEqual([409, 'ROOM_BUSY']);
      const instrClash = await schedule(w.hq, w, { room_id: w.roomR2, ...SLOT(10, '10:30', '11:30') });
      expect([instrClash.status, instrClash.body.error.code]).toEqual([409, 'INSTRUCTOR_BUSY']);
      expect((await schedule(w.hq, w, { ...SLOT(10, '11:00', '13:00') })).status).toBe(201); // starts exactly when the first ends
      expect((await schedule(w.hq, w, { room_id: w.roomR2, instructor_id: w.instrB, ...SLOT(10, '09:00', '11:00') })).status).toBe(201); // other room and instructor
      expect((await schedule(w.hq, w, { ...SLOT(11, '09:00', '11:00') })).status).toBe(201); // next day
    });

    it('two simultaneous requests for the same slot: exactly one wins', async () => {
      const w = await world();
      const results = await Promise.all([1, 2, 3, 4].map(() => schedule(w.hq, w, SLOT(12, '09:00', '10:00'))));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });

    it('a cancelled session frees its slot, and a moved session is checked again', async () => {
      const w = await world();
      const first = (await schedule(w.hq, w)).body.data;
      expect((await schedule(w.hq, w)).status).toBe(409);
      const cancelled = await w.hq.put(`/sessions/${first.id}`, { room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '11:00'), status: 'CANCELLED' });
      expect(cancelled.body.data.status).toBe('CANCELLED');
      const second = await schedule(w.hq, w);
      expect(second.status).toBe(201);
      // reopening the cancelled one now collides with the second
      const reopen = await w.hq.put(`/sessions/${first.id}`, { room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '11:00'), status: 'SCHEDULED' });
      expect([reopen.status, reopen.body.error.code]).toEqual([409, 'ROOM_BUSY']);
      // moving the second to a free hour works
      expect((await w.hq.put(`/sessions/${second.body.data.id}`, { room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '14:00', '16:00'), status: 'SCHEDULED' })).status).toBe(200);
    });

    it('validates times, resources, branch consistency and seating', async () => {
      const w = await world();
      const code = async (extra: object) => {
        const r = await schedule(w.hq, w, extra);
        return [r.status, r.body.error?.code];
      };
      expect(await code({ starts_at: '2026-11-10T11:00:00+03:00', ends_at: '2026-11-10T09:00:00+03:00' })).toEqual([422, 'INVALID_PERIOD']);
      expect(await code(SLOT(10, '06:00', '19:00'))).toEqual([422, 'SESSION_TOO_LONG']);
      expect((await code({ starts_at: '2026-11-10T09:00:00', ends_at: '2026-11-10T10:00:00' }))[0]).toBe(422); // no offset
      expect(await code({ room_id: w.roomJ })).toEqual([422, 'ROOM_BRANCH_MISMATCH']);
      expect(await code({ instructor_id: w.instrJ })).toEqual([422, 'INSTRUCTOR_BRANCH_MISMATCH']);
      expect(await code({ subject_id: randomUUID() })).toEqual([404, 'SUBJECT_NOT_FOUND']);
      // a room that cannot seat the level's active students
      const tiny = (await w.hq.post('/rooms', { branch_id: w.riyadh, name: 'صغيرة', area_m2: 10, capacity: 1 })).body.data.id as string;
      for (const n of ['أ', 'ب']) await w.hq.post('/students', { branch_id: w.riyadh, full_name: n, program_id: w.program, level_id: w.level1 });
      expect(await code({ room_id: tiny })).toEqual([422, 'ROOM_TOO_SMALL']);
      // inactive room / instructor
      await w.hq.put(`/rooms/${w.roomR2}`, { name: 'R2', area_m2: 50, capacity: 20, active: false });
      expect(await code({ room_id: w.roomR2 })).toEqual([422, 'ROOM_INACTIVE']);
      await w.hq.put(`/instructors/${w.instrB}`, { full_name: 'أ. منى', active: false });
      expect(await code({ instructor_id: w.instrB })).toEqual([422, 'INSTRUCTOR_INACTIVE']);
    });

    it('a held session cannot be moved or reopened', async () => {
      const w = await world();
      const s = (await schedule(w.hq, w)).body.data;
      const body = { room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '11:00') };
      expect((await w.hq.put(`/sessions/${s.id}`, { ...body, status: 'HELD' })).status).toBe(200);
      expect((await w.hq.put(`/sessions/${s.id}`, { ...body, status: 'SCHEDULED' })).body.error.code).toBe('SESSION_ALREADY_HELD');
      expect((await w.hq.put(`/sessions/${s.id}`, { ...body, ...SLOT(10, '12:00', '13:00'), status: 'HELD' })).body.error.code).toBe('SESSION_ALREADY_HELD');
    });

    it('lists sessions in a time window', async () => {
      const w = await world();
      await schedule(w.hq, w, SLOT(20, '09:00', '10:00'));
      await schedule(w.hq, w, SLOT(21, '09:00', '10:00'));
      const day = (await w.hq.get(`/sessions?branch_id=${w.riyadh}&from=${encodeURIComponent('2026-11-20T00:00:00+03:00')}&to=${encodeURIComponent('2026-11-21T00:00:00+03:00')}`)).body.data.sessions;
      expect(day).toHaveLength(1);
    });
  });

  describe('attendance and instructor view', () => {
    it('records attendance only for the students of the session level, and an instructor sees only their own sessions', async () => {
      const w = await world();
      const stud = async (name: string, level: string) => (await w.hq.post('/students', { branch_id: w.riyadh, full_name: name, program_id: w.program, level_id: level })).body.data.id as string;
      const s1 = await stud('أحمد', w.level1);
      const s2 = await stud('ليلى', w.level1);
      const s3 = await stud('خالد', w.level2); // other level
      const mine = (await schedule(w.hq, w)).body.data.id as string;
      const theirs = (await schedule(w.hq, w, { room_id: w.roomR2, instructor_id: w.instrB })).body.data.id as string;

      // The instructor signs in with a normal account; the institute role INSTRUCTOR (given by HQ) plus the linked instructor record scope what they see.
      expect((await w.hq.put('/members', { email: `${w.instructorUserA}@t.test`, role: 'INSTRUCTOR' })).status).toBe(200);
      const instr = as(tokenOf(w.instructorUserA, 'INSTRUCTOR'));
      expect((await instr.get('/sessions')).body.data.sessions.map((s: { id: string }) => s.id)).toEqual([mine]);
      const roster = (await instr.get(`/sessions/${mine}/roster`)).body.data;
      expect(roster.students.map((s: { id: string }) => s.id).sort()).toEqual([s1, s2].sort());
      expect((await instr.get(`/sessions/${theirs}/roster`)).status).toBe(404);

      const rec = await instr.put(`/sessions/${mine}/attendance`, { records: [{ student_id: s1, status: 'PRESENT' }, { student_id: s2, status: 'LATE' }] });
      expect(rec.body.data.saved).toBe(2);
      await instr.put(`/sessions/${mine}/attendance`, { records: [{ student_id: s2, status: 'ABSENT' }] }); // correcting overwrites
      const after = (await w.hq.get(`/sessions/${mine}/roster`)).body.data.students as { id: string; attendance: string }[];
      expect(Object.fromEntries(after.map((s) => [s.id, s.attendance]))).toEqual({ [s1]: 'PRESENT', [s2]: 'ABSENT' });

      const outsider = await instr.put(`/sessions/${mine}/attendance`, { records: [{ student_id: s3, status: 'PRESENT' }] });
      expect([outsider.status, outsider.body.error.code]).toEqual([422, 'STUDENT_NOT_IN_SESSION']);
      expect((await instr.put(`/sessions/${theirs}/attendance`, { records: [{ student_id: s1, status: 'PRESENT' }] })).status).toBe(404);
      expect((await instr.put(`/sessions/${mine}/attendance`, { records: [{ student_id: s1, status: 'MAYBE' }] })).status).toBe(422);

      // an instructor cannot schedule, nor see students, programs' money or other instructors' rates
      expect((await schedule(instr, w, SLOT(15, '09:00', '10:00'))).status).toBe(403);
      expect((await instr.get('/students')).status).toBe(403);
      expect((await instr.get('/instructors')).status).toBe(403);
      expect((await instr.get('/programs')).body.data.programs[0]).not.toHaveProperty('fee');

      // cancelled sessions take no attendance
      await w.hq.put(`/sessions/${mine}`, { room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '11:00'), status: 'CANCELLED' });
      expect((await instr.put(`/sessions/${mine}/attendance`, { records: [{ student_id: s1, status: 'PRESENT' }] })).body.error.code).toBe('SESSION_CANCELLED');
    });

    it('an instructor account not linked to any instructor record sees nothing', async () => {
      const w = await world();
      await schedule(w.hq, w);
      const stranger = as(tokenOf(managerUser, 'INSTRUCTOR'));
      await w.hq.put('/members', { email: `${managerUser}@t.test`, role: 'INSTRUCTOR' });
      expect((await stranger.get('/sessions')).body.data.sessions).toEqual([]);
    });
  });

  describe('roles, branch scope and money', () => {
    it('a branch manager works only in their branch; student affairs never see fees or hourly rates', async () => {
      const w = await world();
      await w.hq.put('/members', { email: `${managerUser}@t.test`, role: 'BRANCH_MANAGER', branch_id: w.riyadh });
      await w.hq.put('/members', { email: `${affairsUser}@t.test`, role: 'STUDENT_AFFAIRS', branch_id: w.riyadh });
      const mgr = as(tokenOf(managerUser, 'INSTRUCTOR'));
      const affairs = as(tokenOf(affairsUser, 'INSTRUCTOR'));

      const jProgram = (await w.hq.post('/programs', { branch_id: w.jeddah, name: 'برنامج جدة' })).body.data.id as string;
      const jStudent = (await w.hq.post('/students', { branch_id: w.jeddah, full_name: 'نواف' })).body.data.id as string;
      expect((await mgr.get('/programs')).body.data.programs.every((p: { branch_id: string }) => p.branch_id === w.riyadh)).toBe(true);
      expect((await mgr.put(`/programs/${jProgram}`, { name: 'x' })).status).toBe(404);
      expect((await mgr.post(`/programs/${jProgram}/levels`, { name: 'م', sort_order: 1 })).status).toBe(404);
      expect((await mgr.put(`/students/${jStudent}`, { full_name: 'x' })).status).toBe(404);
      expect((await mgr.post('/instructors', { branch_id: w.jeddah, full_name: 'x' })).status).toBe(404);
      expect((await mgr.post('/sessions', { subject_id: randomUUID(), room_id: w.roomJ, instructor_id: w.instrJ, ...SLOT(10, '09:00', '10:00') })).status).toBe(404);
      expect((await mgr.get('/instructors')).body.data.instructors[0]).toHaveProperty('hourly_rate');

      const list = (await affairs.get('/programs')).body.data.programs[0];
      expect(list).not.toHaveProperty('fee');
      expect(list.levels[0].subjects[0]).not.toHaveProperty('fee');
      expect((await affairs.get('/instructors')).body.data.instructors[0]).not.toHaveProperty('hourly_rate');
      expect((await affairs.post('/programs', { branch_id: w.riyadh, name: 'x' })).status).toBe(403); // not theirs to create
      expect((await affairs.post('/students', { branch_id: w.riyadh, full_name: 'طالب' })).status).toBe(201);
      expect((await affairs.post('/sessions', { subject_id: w.subject, room_id: w.roomR1, instructor_id: w.instrA, ...SLOT(10, '09:00', '10:00') })).status).toBe(201);

      // an edit by someone who cannot see the rate leaves the stored rate untouched
      await affairs.put(`/instructors/${w.instrA}`, { full_name: 'د. سعد', hourly_rate: '1.00' }); // affairs may not write instructors
      expect((await w.hq.get('/instructors')).body.data.instructors.find((i: { id: string }) => i.id === w.instrA).hourly_rate).toBe('150.00');
    });
  });

  describe('tenant isolation', () => {
    it('another institute sees nothing and cannot reach records by id', async () => {
      const w = await world();
      const s = (await schedule(w.hq, w)).body.data.id as string;
      const other = as(tokenOf(randomUUID(), 'TENANT_ADMIN', tenantB), tenantB);
      expect((await other.get('/programs')).body.data.programs).toEqual([]);
      expect((await other.get('/sessions')).body.data.sessions).toEqual([]);
      expect((await other.get(`/sessions/${s}/roster`)).status).toBe(404);
      expect((await other.put(`/programs/${w.program}`, { name: 'x' })).status).toBe(404);
      const branchB = (await other.post('/branches', { name: 'فرعي' })).body.data.id as string;
      expect((await other.post('/students', { branch_id: branchB, full_name: 'x', program_id: w.program })).status).toBe(422);
    });
  });
});
