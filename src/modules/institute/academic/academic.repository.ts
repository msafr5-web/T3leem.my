import { Prisma } from '@prisma/client';
import { forTenant, withTenantTransaction } from '../../../config/database';
import type { Actor } from '../../provider/provider.types';

/** Decimals travel as strings so money never passes through floating point. */
export interface SubjectRow {
  id: string;
  branchId: string;
  levelId: string;
  name: string;
  hours: number;
  fee: string | null;
}
export interface LevelRow {
  id: string;
  branchId: string;
  programId: string;
  name: string;
  sortOrder: number;
  subjects: SubjectRow[];
}
export interface ProgramRow {
  id: string;
  branchId: string;
  name: string;
  description: string | null;
  admissionRequirements: string | null;
  fee: string;
  active: boolean;
  levels: LevelRow[];
}
export interface ProgramInput {
  branchId: string;
  name: string;
  description: string | null;
  admissionRequirements: string | null;
  fee: string;
  active: boolean;
}

export interface InstructorRow {
  id: string;
  branchId: string;
  userId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  qualifications: string | null;
  hourlyRate: string;
  active: boolean;
}
export type InstructorInput = Omit<InstructorRow, 'id'>;

export type StudentStatus = 'ACTIVE' | 'GRADUATED' | 'SUSPENDED' | 'WITHDRAWN';
export interface StudentRow {
  id: string;
  branchId: string;
  programId: string | null;
  levelId: string | null;
  userId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: StudentStatus;
  enrolledOn: string | null;
}
export type StudentInput = Omit<StudentRow, 'id'>;

export type SessionStatus = 'SCHEDULED' | 'HELD' | 'CANCELLED';
export interface SessionRow {
  id: string;
  branchId: string;
  subjectId: string;
  roomId: string;
  instructorId: string;
  startsAt: Date;
  endsAt: Date;
  status: SessionStatus;
  notes: string | null;
}
export type SessionInput = Omit<SessionRow, 'id'>;

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export interface AttendanceRow {
  studentId: string;
  status: AttendanceStatus;
}

/** `conflict` = the database refused an overlapping booking (which resource is double-booked is named). */
export type AWrite<T> = { kind: 'ok'; value: T } | { kind: 'not_found' } | { kind: 'duplicate' } | { kind: 'in_use' } | { kind: 'conflict'; with: 'room' | 'instructor' };

export interface AcademicRepository {
  listPrograms(tenantId: string, branchId: string | null): Promise<ProgramRow[]>;
  getProgram(tenantId: string, id: string): Promise<ProgramRow | null>;
  createProgram(tenantId: string, actor: Actor, input: ProgramInput): Promise<AWrite<ProgramRow>>;
  updateProgram(tenantId: string, actor: Actor, id: string, input: Omit<ProgramInput, 'branchId'>): Promise<AWrite<ProgramRow>>;
  deleteProgram(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>>;
  getLevel(tenantId: string, id: string): Promise<(Omit<LevelRow, 'subjects'> & { programBranchId: string }) | null>;
  createLevel(tenantId: string, actor: Actor, input: { branchId: string; programId: string; name: string; sortOrder: number }): Promise<AWrite<Omit<LevelRow, 'subjects'>>>;
  deleteLevel(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>>;
  getSubject(tenantId: string, id: string): Promise<(SubjectRow & { programId: string }) | null>;
  createSubject(tenantId: string, actor: Actor, input: { branchId: string; levelId: string; name: string; hours: number; fee: string | null }): Promise<AWrite<SubjectRow>>;
  deleteSubject(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>>;

  listInstructors(tenantId: string, branchId: string | null): Promise<InstructorRow[]>;
  getInstructor(tenantId: string, id: string): Promise<InstructorRow | null>;
  instructorOfUser(tenantId: string, userId: string): Promise<InstructorRow | null>;
  createInstructor(tenantId: string, actor: Actor, input: InstructorInput): Promise<AWrite<InstructorRow>>;
  updateInstructor(tenantId: string, actor: Actor, id: string, input: InstructorInput): Promise<AWrite<InstructorRow>>;
  deleteInstructor(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>>;

  listStudents(tenantId: string, filter: { branchId: string | null; programId?: string; status?: StudentStatus }): Promise<StudentRow[]>;
  getStudent(tenantId: string, id: string): Promise<StudentRow | null>;
  createStudent(tenantId: string, actor: Actor, input: StudentInput): Promise<AWrite<StudentRow>>;
  updateStudent(tenantId: string, actor: Actor, id: string, input: StudentInput): Promise<AWrite<StudentRow>>;
  deleteStudent(tenantId: string, actor: Actor, id: string): Promise<boolean>;

  listSessions(tenantId: string, filter: { branchId: string | null; instructorId?: string; from?: Date; to?: Date }): Promise<SessionRow[]>;
  getSession(tenantId: string, id: string): Promise<SessionRow | null>;
  createSession(tenantId: string, actor: Actor, input: SessionInput): Promise<AWrite<SessionRow>>;
  updateSession(tenantId: string, actor: Actor, id: string, input: Omit<SessionInput, 'branchId' | 'subjectId'>): Promise<AWrite<SessionRow>>;

  listAttendance(tenantId: string, sessionId: string): Promise<AttendanceRow[]>;
  saveAttendance(tenantId: string, actor: Actor, session: { id: string; branchId: string }, rows: AttendanceRow[]): Promise<AWrite<number>>;
}

const audit = (tx: Prisma.TransactionClient, tenantId: string, actor: Actor, action: string, entityId: string, metadata: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { tenantId, actorId: actor.userId, actorRole: actor.role, action, entityType: 'institute', entityId, metadata, ipAddress: actor.ip } });

const code = (e: unknown): string | null => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null);
const isUnique = (e: unknown) => code(e) === 'P2002';
/**
 * Foreign-key violation. Prisma reports P2003 for most, but PostgreSQL's RESTRICT on delete (SQLSTATE 23001) surfaces
 * as an unknown request error, so the database code in the message is checked too (otherwise a delete would be a 500).
 */
const isFk = (e: unknown) => {
  if (code(e) === 'P2003') return true;
  if (e instanceof Prisma.PrismaClientUnknownRequestError) return /23001|23503|violates RESTRICT|foreign key constraint/i.test(e.message);
  return false;
};
/** Postgres 23P01 (exclusion violation): which constraint fired tells us which resource is double-booked. */
const conflictOf = (e: unknown): 'room' | 'instructor' | null => {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}` : '';
  if (text.includes('class_sessions_no_room_overlap')) return 'room';
  if (text.includes('class_sessions_no_instructor_overlap')) return 'instructor';
  return null;
};
const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const money = (d: Prisma.Decimal): string => d.toFixed(2);

const toSubject = (s: { id: string; branchId: string; levelId: string; name: string; hours: number; fee: Prisma.Decimal | null }): SubjectRow => ({
  id: s.id,
  branchId: s.branchId,
  levelId: s.levelId,
  name: s.name,
  hours: s.hours,
  fee: s.fee ? money(s.fee) : null,
});
type LevelWithSubjects = { id: string; branchId: string; programId: string; name: string; sortOrder: number; subjects: Parameters<typeof toSubject>[0][] };
const toLevel = (l: LevelWithSubjects): LevelRow => ({ id: l.id, branchId: l.branchId, programId: l.programId, name: l.name, sortOrder: l.sortOrder, subjects: l.subjects.map(toSubject) });
const toProgram = (p: { id: string; branchId: string; name: string; description: string | null; admissionRequirements: string | null; fee: Prisma.Decimal; active: boolean; levels: LevelWithSubjects[] }): ProgramRow => ({
  id: p.id,
  branchId: p.branchId,
  name: p.name,
  description: p.description,
  admissionRequirements: p.admissionRequirements,
  fee: money(p.fee),
  active: p.active,
  levels: p.levels.map(toLevel),
});
const treeInclude = { levels: { orderBy: { sortOrder: 'asc' as const }, include: { subjects: { orderBy: { name: 'asc' as const } } } } };

const toInstructor = (i: { id: string; branchId: string; userId: string | null; fullName: string; phone: string | null; email: string | null; qualifications: string | null; hourlyRate: Prisma.Decimal; active: boolean }): InstructorRow => ({
  id: i.id,
  branchId: i.branchId,
  userId: i.userId,
  fullName: i.fullName,
  phone: i.phone,
  email: i.email,
  qualifications: i.qualifications,
  hourlyRate: money(i.hourlyRate),
  active: i.active,
});
const toStudent = (s: { id: string; branchId: string; programId: string | null; levelId: string | null; userId: string | null; fullName: string; phone: string | null; email: string | null; status: string; enrolledOn: Date | null }): StudentRow => ({
  id: s.id,
  branchId: s.branchId,
  programId: s.programId,
  levelId: s.levelId,
  userId: s.userId,
  fullName: s.fullName,
  phone: s.phone,
  email: s.email,
  status: s.status as StudentStatus,
  enrolledOn: dateOnly(s.enrolledOn),
});
const toSession = (s: { id: string; branchId: string; subjectId: string; roomId: string; instructorId: string; startsAt: Date; endsAt: Date; status: string; notes: string | null }): SessionRow => ({
  id: s.id,
  branchId: s.branchId,
  subjectId: s.subjectId,
  roomId: s.roomId,
  instructorId: s.instructorId,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  status: s.status as SessionStatus,
  notes: s.notes,
});

export class PrismaAcademicRepository implements AcademicRepository {
  // ---- programs / levels / subjects ----
  async listPrograms(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).program.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, include: treeInclude, orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
    return rows.map(toProgram);
  }
  async getProgram(tenantId: string, id: string) {
    const p = await forTenant(tenantId).program.findFirst({ where: { tenantId, id }, include: treeInclude });
    return p ? toProgram(p) : null;
  }
  createProgram(tenantId: string, actor: Actor, input: ProgramInput): Promise<AWrite<ProgramRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const p = await tx.program.create({ data: { tenantId, ...input, fee: new Prisma.Decimal(input.fee) }, include: treeInclude });
        await audit(tx, tenantId, actor, 'institute.program_created', p.id, { name: p.name, branchId: p.branchId });
        return { kind: 'ok' as const, value: toProgram(p) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateProgram(tenantId: string, actor: Actor, id: string, input: Omit<ProgramInput, 'branchId'>): Promise<AWrite<ProgramRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.program.updateMany({ where: { tenantId, id }, data: { ...input, fee: new Prisma.Decimal(input.fee) } });
        if (count === 0) return { kind: 'not_found' as const };
        const p = await tx.program.findFirstOrThrow({ where: { tenantId, id }, include: treeInclude });
        await audit(tx, tenantId, actor, 'institute.program_updated', id, { name: p.name, active: p.active });
        return { kind: 'ok' as const, value: toProgram(p) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        throw e;
      }
    });
  }
  deleteProgram(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.program.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.program_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const }; // students enrolled, or sessions scheduled for its subjects
        throw e;
      }
    });
  }
  async getLevel(tenantId: string, id: string) {
    const l = await forTenant(tenantId).level.findFirst({ where: { tenantId, id }, include: { program: { select: { branchId: true } } } });
    return l ? { id: l.id, branchId: l.branchId, programId: l.programId, name: l.name, sortOrder: l.sortOrder, programBranchId: l.program.branchId } : null;
  }
  createLevel(tenantId: string, actor: Actor, input: { branchId: string; programId: string; name: string; sortOrder: number }): Promise<AWrite<Omit<LevelRow, 'subjects'>>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const l = await tx.level.create({ data: { tenantId, ...input } });
        await audit(tx, tenantId, actor, 'institute.level_created', l.id, { programId: l.programId, name: l.name });
        return { kind: 'ok' as const, value: { id: l.id, branchId: l.branchId, programId: l.programId, name: l.name, sortOrder: l.sortOrder } };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteLevel(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.level.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.level_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const };
        throw e;
      }
    });
  }
  async getSubject(tenantId: string, id: string) {
    const s = await forTenant(tenantId).subject.findFirst({ where: { tenantId, id }, include: { level: { select: { programId: true } } } });
    return s ? { ...toSubject(s), programId: s.level.programId } : null;
  }
  createSubject(tenantId: string, actor: Actor, input: { branchId: string; levelId: string; name: string; hours: number; fee: string | null }): Promise<AWrite<SubjectRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const s = await tx.subject.create({ data: { tenantId, ...input, fee: input.fee === null ? null : new Prisma.Decimal(input.fee) } });
        await audit(tx, tenantId, actor, 'institute.subject_created', s.id, { levelId: s.levelId, name: s.name });
        return { kind: 'ok' as const, value: toSubject(s) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteSubject(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.subject.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.subject_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const };
        throw e;
      }
    });
  }

  // ---- instructors ----
  async listInstructors(tenantId: string, branchId: string | null) {
    const rows = await forTenant(tenantId).instructor.findMany({ where: { tenantId, ...(branchId ? { branchId } : {}) }, orderBy: [{ branchId: 'asc' }, { fullName: 'asc' }] });
    return rows.map(toInstructor);
  }
  async getInstructor(tenantId: string, id: string) {
    const i = await forTenant(tenantId).instructor.findFirst({ where: { tenantId, id } });
    return i ? toInstructor(i) : null;
  }
  async instructorOfUser(tenantId: string, userId: string) {
    const i = await forTenant(tenantId).instructor.findFirst({ where: { tenantId, userId } });
    return i ? toInstructor(i) : null;
  }
  createInstructor(tenantId: string, actor: Actor, input: InstructorInput): Promise<AWrite<InstructorRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const i = await tx.instructor.create({ data: { tenantId, ...input, hourlyRate: new Prisma.Decimal(input.hourlyRate) } });
        await audit(tx, tenantId, actor, 'institute.instructor_created', i.id, { branchId: i.branchId });
        return { kind: 'ok' as const, value: toInstructor(i) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const }; // the account is already linked to another instructor
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateInstructor(tenantId: string, actor: Actor, id: string, input: InstructorInput): Promise<AWrite<InstructorRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { branchId: _b, ...rest } = input; // an instructor stays in their branch
        const { count } = await tx.instructor.updateMany({ where: { tenantId, id }, data: { ...rest, hourlyRate: new Prisma.Decimal(input.hourlyRate) } });
        if (count === 0) return { kind: 'not_found' as const };
        const i = await tx.instructor.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.instructor_updated', id, { active: i.active });
        return { kind: 'ok' as const, value: toInstructor(i) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteInstructor(tenantId: string, actor: Actor, id: string): Promise<AWrite<void>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.instructor.deleteMany({ where: { tenantId, id } });
        if (count === 0) return { kind: 'not_found' as const };
        await audit(tx, tenantId, actor, 'institute.instructor_deleted', id, {});
        return { kind: 'ok' as const, value: undefined };
      } catch (e) {
        if (isFk(e)) return { kind: 'in_use' as const };
        throw e;
      }
    });
  }

  // ---- students ----
  async listStudents(tenantId: string, f: { branchId: string | null; programId?: string; status?: StudentStatus }) {
    const rows = await forTenant(tenantId).student.findMany({
      where: { tenantId, ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.programId ? { programId: f.programId } : {}), ...(f.status ? { status: f.status } : {}) },
      orderBy: [{ branchId: 'asc' }, { fullName: 'asc' }],
    });
    return rows.map(toStudent);
  }
  async getStudent(tenantId: string, id: string) {
    const s = await forTenant(tenantId).student.findFirst({ where: { tenantId, id } });
    return s ? toStudent(s) : null;
  }
  createStudent(tenantId: string, actor: Actor, input: StudentInput): Promise<AWrite<StudentRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const s = await tx.student.create({ data: { tenantId, ...input, enrolledOn: input.enrolledOn ? new Date(`${input.enrolledOn}T00:00:00Z`) : null } });
        await audit(tx, tenantId, actor, 'institute.student_created', s.id, { branchId: s.branchId, programId: s.programId });
        return { kind: 'ok' as const, value: toStudent(s) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateStudent(tenantId: string, actor: Actor, id: string, input: StudentInput): Promise<AWrite<StudentRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { branchId: _b, ...rest } = input; // a student stays in their branch
        const { count } = await tx.student.updateMany({ where: { tenantId, id }, data: { ...rest, enrolledOn: input.enrolledOn ? new Date(`${input.enrolledOn}T00:00:00Z`) : null } });
        if (count === 0) return { kind: 'not_found' as const };
        const s = await tx.student.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.student_updated', id, { status: s.status, programId: s.programId, levelId: s.levelId });
        return { kind: 'ok' as const, value: toStudent(s) };
      } catch (e) {
        if (isUnique(e)) return { kind: 'duplicate' as const };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  deleteStudent(tenantId: string, actor: Actor, id: string): Promise<boolean> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { count } = await tx.student.deleteMany({ where: { tenantId, id } });
      if (count > 0) await audit(tx, tenantId, actor, 'institute.student_deleted', id, {});
      return count > 0;
    });
  }

  // ---- sessions ----
  async listSessions(tenantId: string, f: { branchId: string | null; instructorId?: string; from?: Date; to?: Date }) {
    const rows = await forTenant(tenantId).classSession.findMany({
      where: {
        tenantId,
        ...(f.branchId ? { branchId: f.branchId } : {}),
        ...(f.instructorId ? { instructorId: f.instructorId } : {}),
        ...(f.from || f.to ? { startsAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return rows.map(toSession);
  }
  async getSession(tenantId: string, id: string) {
    const s = await forTenant(tenantId).classSession.findFirst({ where: { tenantId, id } });
    return s ? toSession(s) : null;
  }
  createSession(tenantId: string, actor: Actor, input: SessionInput): Promise<AWrite<SessionRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const s = await tx.classSession.create({ data: { tenantId, ...input } });
        await audit(tx, tenantId, actor, 'institute.session_scheduled', s.id, { roomId: s.roomId, instructorId: s.instructorId, startsAt: s.startsAt.toISOString() });
        return { kind: 'ok' as const, value: toSession(s) };
      } catch (e) {
        const c = conflictOf(e);
        if (c) return { kind: 'conflict' as const, with: c };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
  updateSession(tenantId: string, actor: Actor, id: string, input: Omit<SessionInput, 'branchId' | 'subjectId'>): Promise<AWrite<SessionRow>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const { count } = await tx.classSession.updateMany({ where: { tenantId, id }, data: input });
        if (count === 0) return { kind: 'not_found' as const };
        const s = await tx.classSession.findFirstOrThrow({ where: { tenantId, id } });
        await audit(tx, tenantId, actor, 'institute.session_updated', id, { status: s.status, roomId: s.roomId, instructorId: s.instructorId, startsAt: s.startsAt.toISOString() });
        return { kind: 'ok' as const, value: toSession(s) };
      } catch (e) {
        const c = conflictOf(e);
        if (c) return { kind: 'conflict' as const, with: c };
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }

  // ---- attendance ----
  async listAttendance(tenantId: string, sessionId: string) {
    const rows = await forTenant(tenantId).attendance.findMany({ where: { tenantId, sessionId } });
    return rows.map((r) => ({ studentId: r.studentId, status: r.status as AttendanceStatus }));
  }
  saveAttendance(tenantId: string, actor: Actor, session: { id: string; branchId: string }, rows: AttendanceRow[]): Promise<AWrite<number>> {
    return withTenantTransaction(tenantId, async (tx) => {
      try {
        for (const r of rows) {
          await tx.attendance.upsert({
            where: { sessionId_studentId: { sessionId: session.id, studentId: r.studentId } },
            create: { tenantId, branchId: session.branchId, sessionId: session.id, studentId: r.studentId, status: r.status },
            update: { status: r.status, recordedAt: new Date() },
          });
        }
        await audit(tx, tenantId, actor, 'institute.attendance_recorded', session.id, { count: rows.length });
        return { kind: 'ok' as const, value: rows.length };
      } catch (e) {
        if (isFk(e)) return { kind: 'not_found' as const };
        throw e;
      }
    });
  }
}
