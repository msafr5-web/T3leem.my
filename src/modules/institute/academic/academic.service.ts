import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import { can, canSeeValues, inScope, type Action, type Principal, type Resource } from '../institute.access';
import type { InstituteRepository } from '../institute.repository';
import type { Caller, InstituteService } from '../institute.service';
import type {
  AWrite,
  AcademicRepository,
  AttendanceRow,
  AttendanceStatus,
  InstructorInput,
  InstructorRow,
  LevelRow,
  ProgramInput,
  ProgramRow,
  SessionInput,
  SessionRow,
  SessionStatus,
  StudentInput,
  StudentRow,
  StudentStatus,
  SubjectRow,
} from './academic.repository';

/** Fees and rates are absent (not null) for roles that may not see money. */
export type PublicSubject = Omit<SubjectRow, 'fee'> & { fee?: string | null };
export type PublicLevel = Omit<LevelRow, 'subjects'> & { subjects: PublicSubject[] };
export type PublicProgram = Omit<ProgramRow, 'fee' | 'levels'> & { fee?: string; levels: PublicLevel[] };
export type PublicInstructor = Omit<InstructorRow, 'hourlyRate'> & { hourlyRate?: string };

export const SESSION_LIMITS = { maxHours: 12 } as const;

export class AcademicService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly inst: InstituteService,
    private readonly base: Pick<InstituteRepository, 'getBranch' | 'getRoom'>,
  ) {}

  private allow(p: Principal, resource: Resource, action: Action): void {
    if (!can(p.role, resource, action)) throw HttpError.forbidden('Your institute role does not allow this');
  }
  private actor(c: Caller): Actor {
    return { userId: c.userId, role: c.userRole, ip: c.ip };
  }
  /** Out-of-scope records look exactly like missing ones. */
  private static missing(what: string): HttpError {
    return HttpError.notFound(`${what.toUpperCase()}_NOT_FOUND`, `${what} not found`);
  }
  private static written<T>(r: AWrite<T>, what: string): T {
    switch (r.kind) {
      case 'ok':
        return r.value;
      case 'duplicate':
        throw HttpError.conflict(`${what.toUpperCase()}_EXISTS`, `A ${what} like this already exists`);
      case 'in_use':
        throw HttpError.conflict(`${what.toUpperCase()}_IN_USE`, `This ${what} is still referenced and cannot be deleted`);
      case 'conflict':
        throw HttpError.conflict(r.with === 'room' ? 'ROOM_BUSY' : 'INSTRUCTOR_BUSY', r.with === 'room' ? 'The room is already booked at that time' : 'The instructor is already booked at that time');
      default:
        throw AcademicService.missing(what);
    }
  }
  private scope(p: Principal, requested?: string): string | null | 'none' {
    if (p.branchId === null) return requested ?? null;
    return requested && requested !== p.branchId ? 'none' : p.branchId;
  }
  private async branchInScope(tenantId: string, p: Principal, branchId: string): Promise<void> {
    if (!inScope(p, branchId) || !(await this.base.getBranch(tenantId, branchId))) throw AcademicService.missing('branch');
  }

  // ---- programs ----
  private pubProgram(p: Principal, row: ProgramRow): PublicProgram {
    if (canSeeValues(p.role)) return row;
    const { fee: _f, levels, ...rest } = row;
    return { ...rest, levels: levels.map((l) => ({ ...l, subjects: l.subjects.map(({ fee: _sf, ...s }) => s) })) };
  }
  async listPrograms(tenantId: string, c: Caller, branchId?: string): Promise<PublicProgram[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'read');
    const scope = this.scope(p, branchId);
    return scope === 'none' ? [] : (await this.repo.listPrograms(tenantId, scope)).map((r) => this.pubProgram(p, r));
  }
  async createProgram(tenantId: string, c: Caller, input: ProgramInput): Promise<PublicProgram> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    return this.pubProgram(p, AcademicService.written(await this.repo.createProgram(tenantId, this.actor(c), input), 'program'));
  }
  async updateProgram(tenantId: string, c: Caller, id: string, input: Omit<ProgramInput, 'branchId'>): Promise<PublicProgram> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    await this.programInScope(tenantId, p, id);
    return this.pubProgram(p, AcademicService.written(await this.repo.updateProgram(tenantId, this.actor(c), id, input), 'program'));
  }
  async deleteProgram(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    await this.programInScope(tenantId, p, id);
    AcademicService.written(await this.repo.deleteProgram(tenantId, this.actor(c), id), 'program');
  }
  async addLevel(tenantId: string, c: Caller, programId: string, input: { name: string; sortOrder: number }) {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    const program = await this.programInScope(tenantId, p, programId);
    return AcademicService.written(await this.repo.createLevel(tenantId, this.actor(c), { ...input, programId, branchId: program.branchId }), 'level');
  }
  async deleteLevel(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    const level = await this.repo.getLevel(tenantId, id);
    if (!level || !inScope(p, level.branchId)) throw AcademicService.missing('level');
    AcademicService.written(await this.repo.deleteLevel(tenantId, this.actor(c), id), 'level');
  }
  async addSubject(tenantId: string, c: Caller, levelId: string, input: { name: string; hours: number; fee: string | null }): Promise<PublicSubject> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    const level = await this.repo.getLevel(tenantId, levelId);
    if (!level || !inScope(p, level.branchId)) throw AcademicService.missing('level');
    // A role without money access may add the subject but not set a price it cannot see.
    const fee = canSeeValues(p.role) ? input.fee : null;
    const s = AcademicService.written(await this.repo.createSubject(tenantId, this.actor(c), { ...input, fee, levelId, branchId: level.branchId }), 'subject');
    return canSeeValues(p.role) ? s : (({ fee: _f, ...rest }) => rest)(s);
  }
  async deleteSubject(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'program', 'write');
    const s = await this.repo.getSubject(tenantId, id);
    if (!s || !inScope(p, s.branchId)) throw AcademicService.missing('subject');
    AcademicService.written(await this.repo.deleteSubject(tenantId, this.actor(c), id), 'subject');
  }
  private async programInScope(tenantId: string, p: Principal, id: string): Promise<ProgramRow> {
    const program = await this.repo.getProgram(tenantId, id);
    if (!program || !inScope(p, program.branchId)) throw AcademicService.missing('program');
    return program;
  }

  // ---- instructors ----
  private pubInstructor(p: Principal, i: InstructorRow): PublicInstructor {
    if (canSeeValues(p.role)) return i;
    const { hourlyRate: _r, ...rest } = i;
    return rest;
  }
  async listInstructors(tenantId: string, c: Caller, branchId?: string): Promise<PublicInstructor[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'instructor', 'read');
    const scope = this.scope(p, branchId);
    return scope === 'none' ? [] : (await this.repo.listInstructors(tenantId, scope)).map((i) => this.pubInstructor(p, i));
  }
  async createInstructor(tenantId: string, c: Caller, input: InstructorInput): Promise<PublicInstructor> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'instructor', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    const safe = canSeeValues(p.role) ? input : { ...input, hourlyRate: '0.00' };
    return this.pubInstructor(p, AcademicService.written(await this.repo.createInstructor(tenantId, this.actor(c), safe), 'instructor'));
  }
  async updateInstructor(tenantId: string, c: Caller, id: string, input: InstructorInput): Promise<PublicInstructor> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'instructor', 'write');
    const cur = await this.repo.getInstructor(tenantId, id);
    if (!cur || !inScope(p, cur.branchId)) throw AcademicService.missing('instructor');
    const next = { ...input, branchId: cur.branchId, hourlyRate: canSeeValues(p.role) ? input.hourlyRate : cur.hourlyRate };
    return this.pubInstructor(p, AcademicService.written(await this.repo.updateInstructor(tenantId, this.actor(c), id, next), 'instructor'));
  }
  async deleteInstructor(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'instructor', 'write');
    const cur = await this.repo.getInstructor(tenantId, id);
    if (!cur || !inScope(p, cur.branchId)) throw AcademicService.missing('instructor');
    AcademicService.written(await this.repo.deleteInstructor(tenantId, this.actor(c), id), 'instructor');
  }

  // ---- students ----
  async listStudents(tenantId: string, c: Caller, f: { branchId?: string; programId?: string; status?: StudentStatus }): Promise<StudentRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'student', 'read');
    const scope = this.scope(p, f.branchId);
    return scope === 'none' ? [] : this.repo.listStudents(tenantId, { branchId: scope, programId: f.programId, status: f.status });
  }
  async createStudent(tenantId: string, c: Caller, input: StudentInput): Promise<StudentRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'student', 'write');
    await this.branchInScope(tenantId, p, input.branchId);
    await this.requireTrack(tenantId, input);
    return AcademicService.written(await this.repo.createStudent(tenantId, this.actor(c), input), 'student');
  }
  async updateStudent(tenantId: string, c: Caller, id: string, input: StudentInput): Promise<StudentRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'student', 'write');
    const cur = await this.repo.getStudent(tenantId, id);
    if (!cur || !inScope(p, cur.branchId)) throw AcademicService.missing('student');
    const next = { ...input, branchId: cur.branchId };
    await this.requireTrack(tenantId, next);
    return AcademicService.written(await this.repo.updateStudent(tenantId, this.actor(c), id, next), 'student');
  }
  async deleteStudent(tenantId: string, c: Caller, id: string): Promise<void> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'student', 'write');
    const cur = await this.repo.getStudent(tenantId, id);
    if (!cur || !inScope(p, cur.branchId)) throw AcademicService.missing('student');
    AcademicService.written(await this.repo.deleteStudent(tenantId, this.actor(c), id), 'student');
  }
  /** The program and level must belong to the student's branch, and the level to that program. */
  private async requireTrack(tenantId: string, s: { branchId: string; programId: string | null; levelId: string | null }): Promise<void> {
    if (s.levelId && !s.programId) throw HttpError.unprocessable('LEVEL_NEEDS_PROGRAM', 'Choose the program together with the level');
    if (s.programId) {
      const program = await this.repo.getProgram(tenantId, s.programId);
      if (!program || program.branchId !== s.branchId) throw HttpError.unprocessable('PROGRAM_BRANCH_MISMATCH', 'The program is not offered in the student branch');
      if (s.levelId && !program.levels.some((l) => l.id === s.levelId)) throw HttpError.unprocessable('LEVEL_PROGRAM_MISMATCH', 'The level does not belong to this program');
    }
  }

  // ---- sessions ----
  /** An instructor only ever sees their own sessions, found through the instructor record linked to their account. */
  private async ownInstructorId(tenantId: string, p: Principal): Promise<string | null | undefined> {
    if (p.role !== 'INSTRUCTOR') return undefined; // no extra restriction
    return (await this.repo.instructorOfUser(tenantId, p.userId))?.id ?? null; // null = linked to nobody: sees nothing
  }
  async listSessions(tenantId: string, c: Caller, f: { branchId?: string; from?: Date; to?: Date }): Promise<SessionRow[]> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'session', 'read');
    const own = await this.ownInstructorId(tenantId, p);
    if (own === null) return [];
    const scope = this.scope(p, f.branchId);
    return scope === 'none' ? [] : this.repo.listSessions(tenantId, { branchId: scope, instructorId: own, from: f.from, to: f.to });
  }
  async scheduleSession(tenantId: string, c: Caller, input: { subjectId: string; roomId: string; instructorId: string; startsAt: Date; endsAt: Date; notes: string | null }): Promise<SessionRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'session', 'write');
    const subject = await this.repo.getSubject(tenantId, input.subjectId);
    if (!subject || !inScope(p, subject.branchId)) throw AcademicService.missing('subject');
    this.checkTimes(input.startsAt, input.endsAt);
    await this.checkResources(tenantId, subject, input);
    return AcademicService.written(await this.repo.createSession(tenantId, this.actor(c), { ...input, branchId: subject.branchId, status: 'SCHEDULED' }), 'session');
  }
  async updateSession(tenantId: string, c: Caller, id: string, input: { roomId: string; instructorId: string; startsAt: Date; endsAt: Date; status: SessionStatus; notes: string | null }): Promise<SessionRow> {
    const p = await this.inst.principal(tenantId, c);
    this.allow(p, 'session', 'write');
    const cur = await this.repo.getSession(tenantId, id);
    if (!cur || !inScope(p, cur.branchId)) throw AcademicService.missing('session');
    if (cur.status === 'HELD' && (input.status !== 'HELD' || +input.startsAt !== +cur.startsAt || +input.endsAt !== +cur.endsAt)) {
      throw HttpError.conflict('SESSION_ALREADY_HELD', 'A session that was held cannot be moved or reopened');
    }
    this.checkTimes(input.startsAt, input.endsAt);
    if (input.status !== 'CANCELLED') {
      const subject = await this.repo.getSubject(tenantId, cur.subjectId);
      if (!subject) throw AcademicService.missing('subject');
      await this.checkResources(tenantId, subject, input);
    }
    return AcademicService.written(await this.repo.updateSession(tenantId, this.actor(c), id, input), 'session');
  }
  private checkTimes(startsAt: Date, endsAt: Date): void {
    if (!(endsAt > startsAt)) throw HttpError.unprocessable('INVALID_PERIOD', 'The session must end after it starts');
    if (endsAt.getTime() - startsAt.getTime() > SESSION_LIMITS.maxHours * 3_600_000) throw HttpError.unprocessable('SESSION_TOO_LONG', `A session is at most ${SESSION_LIMITS.maxHours} hours`);
  }
  /** Room and instructor must be active and in the subject's branch; the room must seat the level's active students. */
  private async checkResources(tenantId: string, subject: SubjectRow & { programId: string }, input: { roomId: string; instructorId: string }): Promise<void> {
    const [room, instructor] = await Promise.all([this.base.getRoom(tenantId, input.roomId), this.repo.getInstructor(tenantId, input.instructorId)]);
    if (!room || room.branchId !== subject.branchId) throw HttpError.unprocessable('ROOM_BRANCH_MISMATCH', 'The room is not in the subject branch');
    if (!instructor || instructor.branchId !== subject.branchId) throw HttpError.unprocessable('INSTRUCTOR_BRANCH_MISMATCH', 'The instructor is not in the subject branch');
    if (!room.active) throw HttpError.unprocessable('ROOM_INACTIVE', 'The room is not in use');
    if (!instructor.active) throw HttpError.unprocessable('INSTRUCTOR_INACTIVE', 'The instructor is not active');
    const enrolled = (await this.roster(tenantId, subject)).filter((s) => s.status === 'ACTIVE').length;
    if (enrolled > room.capacity) throw HttpError.unprocessable('ROOM_TOO_SMALL', `The room seats ${room.capacity} but ${enrolled} students are enrolled in this level`);
  }
  /** Students of the subject's level (the people who attend its sessions). */
  private async roster(tenantId: string, subject: SubjectRow & { programId: string }): Promise<StudentRow[]> {
    return (await this.repo.listStudents(tenantId, { branchId: subject.branchId, programId: subject.programId })).filter((s) => s.levelId === subject.levelId);
  }

  // ---- attendance ----
  private async sessionForAttendance(tenantId: string, p: Principal, action: Action, sessionId: string): Promise<SessionRow> {
    this.allow(p, 'attendance', action);
    const s = await this.repo.getSession(tenantId, sessionId);
    if (!s || !inScope(p, s.branchId)) throw AcademicService.missing('session');
    const own = await this.ownInstructorId(tenantId, p);
    if (own !== undefined && s.instructorId !== own) throw AcademicService.missing('session');
    return s;
  }
  async getRoster(tenantId: string, c: Caller, sessionId: string): Promise<{ session: SessionRow; students: (StudentRow & { attendance: AttendanceStatus | null })[] }> {
    const p = await this.inst.principal(tenantId, c);
    const session = await this.sessionForAttendance(tenantId, p, 'read', sessionId);
    const subject = await this.repo.getSubject(tenantId, session.subjectId);
    if (!subject) throw AcademicService.missing('subject');
    const [students, marks] = await Promise.all([this.roster(tenantId, subject), this.repo.listAttendance(tenantId, sessionId)]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m.status]));
    return { session, students: students.map((s) => ({ ...s, attendance: byStudent.get(s.id) ?? null })) };
  }
  async recordAttendance(tenantId: string, c: Caller, sessionId: string, rows: AttendanceRow[]): Promise<number> {
    const p = await this.inst.principal(tenantId, c);
    const session = await this.sessionForAttendance(tenantId, p, 'write', sessionId);
    if (session.status === 'CANCELLED') throw HttpError.conflict('SESSION_CANCELLED', 'Attendance cannot be recorded for a cancelled session');
    const subject = await this.repo.getSubject(tenantId, session.subjectId);
    if (!subject) throw AcademicService.missing('subject');
    const allowed = new Set((await this.roster(tenantId, subject)).map((s) => s.id));
    const bad = rows.filter((r) => !allowed.has(r.studentId));
    if (bad.length > 0) throw HttpError.unprocessable('STUDENT_NOT_IN_SESSION', 'Some students are not enrolled in this session level', bad.map((b) => b.studentId));
    return AcademicService.written(await this.repo.saveAttendance(tenantId, this.actor(c), { id: session.id, branchId: session.branchId }, rows), 'attendance');
  }
}
