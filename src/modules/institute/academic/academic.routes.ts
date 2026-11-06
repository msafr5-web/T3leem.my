import { Router, type Request, type Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireAuthContext, requireFeature, type JwtVerifyOptions } from '../../../shared/middlewares/auth.middleware';
import { validate } from '../../../shared/middlewares/validate.middleware';
import { ok } from '../../../shared/utils/api-response';
import type { AttendanceStatus, InstructorInput, SessionRow, SessionStatus, StudentInput, StudentRow, StudentStatus } from './academic.repository';
import type { AcademicService, PublicInstructor, PublicLevel, PublicProgram, PublicSubject } from './academic.service';

const uuid = (name: string) => param(name).isUUID().withMessage(`${name} must be a UUID`);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** Instants must carry an offset (Z or +03:00): a bare local time would be read in the server's zone. */
const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const bool = (v: unknown, dflt: boolean) => (v === undefined ? dflt : v === true || v === 'true');
const money = (v: unknown, dflt = '0.00') => (v === undefined || v === null || v === '' ? dflt : Number(v).toFixed(2));

const subjectJson = (s: PublicSubject) => ({ id: s.id, level_id: s.levelId, name: s.name, hours: s.hours, ...(s.fee !== undefined ? { fee: s.fee } : {}) });
const levelJson = (l: PublicLevel) => ({ id: l.id, program_id: l.programId, name: l.name, sort_order: l.sortOrder, subjects: l.subjects.map(subjectJson) });
const programJson = (p: PublicProgram) => ({
  id: p.id,
  branch_id: p.branchId,
  name: p.name,
  description: p.description,
  admission_requirements: p.admissionRequirements,
  active: p.active,
  ...(p.fee !== undefined ? { fee: p.fee } : {}),
  levels: p.levels.map(levelJson),
});
const instructorJson = (i: PublicInstructor) => ({
  id: i.id,
  branch_id: i.branchId,
  user_id: i.userId,
  full_name: i.fullName,
  phone: i.phone,
  email: i.email,
  qualifications: i.qualifications,
  active: i.active,
  ...(i.hourlyRate !== undefined ? { hourly_rate: i.hourlyRate } : {}),
});
const studentJson = (s: StudentRow) => ({ id: s.id, branch_id: s.branchId, program_id: s.programId, level_id: s.levelId, user_id: s.userId, full_name: s.fullName, phone: s.phone, email: s.email, status: s.status, enrolled_on: s.enrolledOn });
const sessionJson = (s: SessionRow) => ({ id: s.id, branch_id: s.branchId, subject_id: s.subjectId, room_id: s.roomId, instructor_id: s.instructorId, starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString(), status: s.status, notes: s.notes });

const programRules = [
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('name is required'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('admission_requirements').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  body('fee').optional({ values: 'null' }).custom((v) => MONEY.test(String(v))).withMessage('fee must be an amount with at most 2 decimals'),
  body('active').optional().isBoolean(),
];
const instructorRules = [
  body('full_name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('full_name is required'),
  body('user_id').optional({ values: 'null' }).isUUID(),
  body('phone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  body('email').optional({ values: 'null' }).isEmail(),
  body('qualifications').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('hourly_rate').optional({ values: 'null' }).custom((v) => MONEY.test(String(v))).withMessage('hourly_rate must be an amount with at most 2 decimals'),
  body('active').optional().isBoolean(),
];
const instructorInput = (b: Record<string, unknown>, branchId: string): InstructorInput => ({
  branchId,
  userId: str(b.user_id),
  fullName: String(b.full_name).trim(),
  phone: str(b.phone),
  email: str(b.email),
  qualifications: str(b.qualifications),
  hourlyRate: money(b.hourly_rate),
  active: bool(b.active, true),
});
const STUDENT_STATUSES = ['ACTIVE', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN'];
const studentRules = [
  body('full_name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('full_name is required'),
  body('program_id').optional({ values: 'null' }).isUUID(),
  body('level_id').optional({ values: 'null' }).isUUID(),
  body('user_id').optional({ values: 'null' }).isUUID(),
  body('phone').optional({ values: 'null' }).isString().isLength({ max: 30 }),
  body('email').optional({ values: 'null' }).isEmail(),
  body('status').optional().isIn(STUDENT_STATUSES),
  body('enrolled_on').optional({ values: 'null' }).isISO8601({ strict: true }).isLength({ min: 10, max: 10 }).withMessage('enrolled_on must be YYYY-MM-DD'),
];
const studentInput = (b: Record<string, unknown>, branchId: string): StudentInput => ({
  branchId,
  programId: str(b.program_id),
  levelId: str(b.level_id),
  userId: str(b.user_id),
  fullName: String(b.full_name).trim(),
  phone: str(b.phone),
  email: str(b.email),
  status: (typeof b.status === 'string' ? b.status : 'ACTIVE') as StudentStatus,
  enrolledOn: str(b.enrolled_on),
});
const instant = (field: string) => body(field).isISO8601({ strict: true }).custom((v) => WITH_OFFSET.test(String(v))).withMessage(`${field} must be an ISO time with an offset, e.g. 2026-11-10T09:00:00+03:00`);

/** Academic side of institute management: programs, instructors, students, class sessions, attendance. */
export function buildAcademicRouter(service: AcademicService, jwt: JwtVerifyOptions): Router {
  const router = Router();
  router.use('/institute', requireFeature('institute'));
  const auth = authenticate(jwt);
  const ctx = (req: Request) => {
    const { tenantId, user } = requireAuthContext(req);
    return { tenantId, caller: { userId: user.id, userRole: user.role, ip: req.ip ?? null } };
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  // ---- programs, levels, subjects ----
  router.get('/institute/programs', auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ programs: (await service.listPrograms(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(programJson) }));
  });
  router.post('/institute/programs', auth, body('branch_id').isUUID(), ...programRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    const created = await service.createProgram(tenantId, caller, { branchId: String(b.branch_id), name: String(b.name).trim(), description: str(b.description), admissionRequirements: str(b.admission_requirements), fee: money(b.fee), active: bool(b.active, true) });
    res.status(201).json(ok(programJson(created)));
  });
  router.put('/institute/programs/:id', auth, uuid('id'), ...programRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    const updated = await service.updateProgram(tenantId, caller, req.params.id as string, { name: String(b.name).trim(), description: str(b.description), admissionRequirements: str(b.admission_requirements), fee: money(b.fee), active: bool(b.active, true) });
    res.json(ok(programJson(updated)));
  });
  router.delete('/institute/programs/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteProgram(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });
  router.post(
    '/institute/programs/:id/levels',
    auth,
    uuid('id'),
    body('name').isString().trim().isLength({ min: 1, max: 80 }),
    body('sort_order').isInt({ min: 1, max: 100 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const l = await service.addLevel(tenantId, caller, req.params.id as string, { name: String(b.name).trim(), sortOrder: Number(b.sort_order) });
      res.status(201).json(ok({ id: l.id, program_id: l.programId, name: l.name, sort_order: l.sortOrder }));
    },
  );
  router.delete('/institute/levels/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteLevel(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });
  router.post(
    '/institute/levels/:id/subjects',
    auth,
    uuid('id'),
    body('name').isString().trim().isLength({ min: 1, max: 120 }),
    body('hours').isInt({ min: 1, max: 2000 }),
    body('fee').optional({ values: 'null' }).custom((v) => MONEY.test(String(v))).withMessage('fee must be an amount with at most 2 decimals'),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const s = await service.addSubject(tenantId, caller, req.params.id as string, { name: String(b.name).trim(), hours: Number(b.hours), fee: b.fee === undefined || b.fee === null || b.fee === '' ? null : money(b.fee) });
      res.status(201).json(ok(subjectJson(s)));
    },
  );
  router.delete('/institute/subjects/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteSubject(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- instructors ----
  router.get('/institute/instructors', auth, query('branch_id').optional().isUUID(), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    noStore(res);
    res.json(ok({ instructors: (await service.listInstructors(tenantId, caller, str(req.query.branch_id) ?? undefined)).map(instructorJson) }));
  });
  router.post('/institute/instructors', auth, body('branch_id').isUUID(), ...instructorRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(instructorJson(await service.createInstructor(tenantId, caller, instructorInput(b, String(b.branch_id))))));
  });
  router.put('/institute/instructors/:id', auth, uuid('id'), ...instructorRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(instructorJson(await service.updateInstructor(tenantId, caller, req.params.id as string, instructorInput(req.body as Record<string, unknown>, '')))));
  });
  router.delete('/institute/instructors/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteInstructor(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- students ----
  router.get(
    '/institute/students',
    auth,
    query('branch_id').optional().isUUID(),
    query('program_id').optional().isUUID(),
    query('status').optional().isIn(STUDENT_STATUSES),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const list = await service.listStudents(tenantId, caller, {
        branchId: str(req.query.branch_id) ?? undefined,
        programId: str(req.query.program_id) ?? undefined,
        status: (str(req.query.status) ?? undefined) as StudentStatus | undefined,
      });
      noStore(res);
      res.json(ok({ students: list.map(studentJson) }));
    },
  );
  router.post('/institute/students', auth, body('branch_id').isUUID(), ...studentRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const b = req.body as Record<string, unknown>;
    res.status(201).json(ok(studentJson(await service.createStudent(tenantId, caller, studentInput(b, String(b.branch_id))))));
  });
  router.put('/institute/students/:id', auth, uuid('id'), ...studentRules, validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    res.json(ok(studentJson(await service.updateStudent(tenantId, caller, req.params.id as string, studentInput(req.body as Record<string, unknown>, '')))));
  });
  router.delete('/institute/students/:id', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    await service.deleteStudent(tenantId, caller, req.params.id as string);
    res.status(204).end();
  });

  // ---- class sessions ----
  router.get(
    '/institute/sessions',
    auth,
    query('branch_id').optional().isUUID(),
    query('from').optional().isISO8601().custom((v) => WITH_OFFSET.test(String(v))),
    query('to').optional().isISO8601().custom((v) => WITH_OFFSET.test(String(v))),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const list = await service.listSessions(tenantId, caller, {
        branchId: str(req.query.branch_id) ?? undefined,
        from: req.query.from ? new Date(String(req.query.from)) : undefined,
        to: req.query.to ? new Date(String(req.query.to)) : undefined,
      });
      noStore(res);
      res.json(ok({ sessions: list.map(sessionJson) }));
    },
  );
  router.post(
    '/institute/sessions',
    auth,
    body('subject_id').isUUID(),
    body('room_id').isUUID(),
    body('instructor_id').isUUID(),
    instant('starts_at'),
    instant('ends_at'),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 500 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const s = await service.scheduleSession(tenantId, caller, { subjectId: String(b.subject_id), roomId: String(b.room_id), instructorId: String(b.instructor_id), startsAt: new Date(String(b.starts_at)), endsAt: new Date(String(b.ends_at)), notes: str(b.notes) });
      res.status(201).json(ok(sessionJson(s)));
    },
  );
  router.put(
    '/institute/sessions/:id',
    auth,
    uuid('id'),
    body('room_id').isUUID(),
    body('instructor_id').isUUID(),
    instant('starts_at'),
    instant('ends_at'),
    body('status').isIn(['SCHEDULED', 'HELD', 'CANCELLED']),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 500 }),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const b = req.body as Record<string, unknown>;
      const s = await service.updateSession(tenantId, caller, req.params.id as string, {
        roomId: String(b.room_id),
        instructorId: String(b.instructor_id),
        startsAt: new Date(String(b.starts_at)),
        endsAt: new Date(String(b.ends_at)),
        status: b.status as SessionStatus,
        notes: str(b.notes),
      });
      res.json(ok(sessionJson(s)));
    },
  );

  // ---- attendance ----
  router.get('/institute/sessions/:id/roster', auth, uuid('id'), validate, async (req: Request, res: Response) => {
    const { tenantId, caller } = ctx(req);
    const r = await service.getRoster(tenantId, caller, req.params.id as string);
    noStore(res);
    res.json(ok({ session: sessionJson(r.session), students: r.students.map((s) => ({ ...studentJson(s), attendance: s.attendance })) }));
  });
  router.put(
    '/institute/sessions/:id/attendance',
    auth,
    uuid('id'),
    body('records').isArray({ min: 1, max: 500 }),
    body('records.*.student_id').isUUID(),
    body('records.*.status').isIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
    validate,
    async (req: Request, res: Response) => {
      const { tenantId, caller } = ctx(req);
      const records = (req.body.records as { student_id: string; status: AttendanceStatus }[]).map((r) => ({ studentId: r.student_id, status: r.status }));
      res.json(ok({ saved: await service.recordAttendance(tenantId, caller, req.params.id as string, records) }));
    },
  );

  return router;
}
