'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, ApiUnavailableError, api } from './api';
import { isValidSlug } from './format';
import { getSession } from './session';

/**
 * Institute-management mutations. Unlike the admin dashboard, these are used by every institute role
 * (branch manager, finance, student affairs...), so any signed-in user may call them; the API decides
 * what each role may do and which branch it may touch. Nothing here is the security boundary.
 */

export interface InstState {
  error?: string;
  done?: string;
  rowErrors?: { row: number; message: string }[];
}

const MESSAGES: Record<string, string> = {
  FEATURE_DISABLED: 'هذه الوحدة غير مفعّلة لأكاديميتك. تواصل مع إدارة المنصة.',
  FORBIDDEN: 'دورك لا يسمح بهذا الإجراء.',
  BRANCH_EXISTS: 'يوجد فرع بهذا الاسم.',
  BRANCH_NOT_FOUND: 'الفرع غير موجود أو خارج صلاحيتك.',
  ROOM_EXISTS: 'يوجد في هذا الفرع قاعة بهذا الاسم.',
  ROOM_NOT_FOUND: 'القاعة غير موجودة أو خارج صلاحيتك.',
  ROOM_IN_USE: 'في هذه القاعة أصول. انقلها أو احذفها أولاً.',
  ROOM_BRANCH_MISMATCH: 'القاعة المختارة ليست في فرع الأصل.',
  ASSET_NOT_FOUND: 'الأصل غير موجود أو خارج صلاحيتك.',
  DEPARTMENT_EXISTS: 'يوجد قسم بهذا الاسم في هذا المستوى.',
  DEPARTMENT_NOT_FOUND: 'القسم غير موجود.',
  DEPARTMENT_IN_USE: 'في هذا القسم موظفون. انقلهم أولاً.',
  DEPARTMENT_BRANCH_MISMATCH: 'القسم المختار ليس من هذا الفرع.',
  STAFF_NOT_FOUND: 'الموظف غير موجود أو خارج صلاحيتك.',
  USER_NOT_FOUND: 'لا يوجد مستخدم بهذا البريد في أكاديميتك. أضفه أولاً من المدربون أو المتدربون.',
  BRANCH_REQUIRED: 'هذا الدور يجب أن يرتبط بفرع واحد.',
  MEMBER_NOT_FOUND: 'العضو غير موجود.',
  INVALID_PERIOD: 'ترتيب التواريخ غير صحيح: النهاية أو الاستحقاق التالي يجب ألا يسبق البداية.',
  FILE_REQUIRED: 'اختر ملف Excel أو CSV.',
  IMPORT_INVALID: 'في الملف صفوف لا يمكن استيرادها، ولم يُستورد شيء. صحّحها وأعد الرفع.',
  PAYLOAD_TOO_LARGE: 'حجم الملف أكبر من المسموح (٢ ميغابايت).',
  VALIDATION_FAILED: 'تحقق من الحقول: القيم غير صحيحة.',
  PROGRAM_EXISTS: 'يوجد برنامج بهذا الاسم في الفرع.',
  PROGRAM_NOT_FOUND: 'البرنامج غير موجود أو خارج صلاحيتك.',
  PROGRAM_IN_USE: 'في هذا البرنامج طلاب أو حصص. انقلهم أو ألغها أولاً.',
  LEVEL_EXISTS: 'يوجد مستوى بهذا الترتيب في البرنامج.',
  LEVEL_NOT_FOUND: 'المستوى غير موجود.',
  LEVEL_IN_USE: 'لهذا المستوى حصص أو طلاب. لا يمكن حذفه.',
  SUBJECT_EXISTS: 'توجد مادة بهذا الاسم في المستوى.',
  SUBJECT_NOT_FOUND: 'المادة غير موجودة.',
  SUBJECT_IN_USE: 'لهذه المادة حصص مجدولة. لا يمكن حذفها.',
  INSTRUCTOR_EXISTS: 'هذا الحساب مرتبط بمدرب آخر.',
  INSTRUCTOR_NOT_FOUND: 'المدرب غير موجود أو خارج صلاحيتك.',
  INSTRUCTOR_IN_USE: 'لهذا المدرب حصص. عطّله بدل حذفه.',
  STUDENT_EXISTS: 'هذا الحساب مرتبط بطالب آخر.',
  STUDENT_NOT_FOUND: 'الطالب غير موجود أو خارج صلاحيتك.',
  LEVEL_NEEDS_PROGRAM: 'اختر البرنامج مع المستوى.',
  PROGRAM_BRANCH_MISMATCH: 'البرنامج غير مطروح في فرع الطالب.',
  LEVEL_PROGRAM_MISMATCH: 'المستوى ليس من هذا البرنامج.',
  ROOM_BUSY: 'القاعة محجوزة في هذا الوقت.',
  INSTRUCTOR_BUSY: 'المدرب لديه حصة أخرى في هذا الوقت.',
  ROOM_TOO_SMALL: 'سعة القاعة أقل من عدد طلاب هذا المستوى.',
  ROOM_INACTIVE: 'القاعة غير مفعّلة.',
  INSTRUCTOR_INACTIVE: 'المدرب غير نشط.',
  INSTRUCTOR_BRANCH_MISMATCH: 'المدرب ليس من فرع المادة.',
  SESSION_TOO_LONG: 'الحصة لا تزيد عن ١٢ ساعة.',
  SESSION_ALREADY_HELD: 'حصة منفذة: لا يمكن نقلها أو إعادة فتحها.',
  SESSION_CANCELLED: 'لا يُسجَّل حضور لحصة ملغاة.',
  SESSION_NOT_FOUND: 'الحصة غير موجودة أو ليست لك.',
  STUDENT_NOT_IN_SESSION: 'بعض الطلاب ليسوا من مستوى هذه الحصة.',
};

function describe(err: unknown): InstState {
  if (err instanceof ApiError) return { error: MESSAGES[err.code] ?? 'تعذّر الحفظ. حاول مرة أخرى.' };
  if (err instanceof ApiUnavailableError) return { error: 'تعذّر الاتصال بالخادم. حاول بعد قليل.' };
  return { error: 'حدث خطأ غير متوقع.' };
}

async function token(slug: string): Promise<string> {
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute`)}`);
  return session.token;
}

const str = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
const optional = (form: FormData, key: string): string | null => str(form, key) || null;
const num = (form: FormData, key: string): number | undefined => (str(form, key) === '' ? undefined : Number(str(form, key)));

async function save(slug: string, path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown, notice: string): Promise<InstState> {
  const t = await token(slug);
  try {
    await api(slug, `/admin/institute${path}`, { method, token: t, body });
  } catch (err) {
    return describe(err);
  }
  revalidatePath(`/${slug}/institute`);
  redirect(`/${slug}/institute?saved=${notice}`);
}

export async function addBranchAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, '/branches', 'POST', { name: str(form, 'name'), city: optional(form, 'city'), address: optional(form, 'address') }, 'branch');
}

export async function addRoomAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(
    slug,
    '/rooms',
    'POST',
    { branch_id: str(form, 'branch_id'), name: str(form, 'name'), kind: str(form, 'kind'), area_m2: num(form, 'area_m2'), capacity: num(form, 'capacity'), power_kw: num(form, 'power_kw') ?? 0 },
    'room',
  );
}
export async function deleteRoomAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/rooms/${encodeURIComponent(id)}`, 'DELETE', undefined, 'room');
}

export async function addAssetAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(
    slug,
    '/assets',
    'POST',
    {
      branch_id: str(form, 'branch_id'),
      room_id: optional(form, 'room_id'),
      name: str(form, 'name'),
      category: optional(form, 'category'),
      serial_no: optional(form, 'serial_no'),
      purchase_date: optional(form, 'purchase_date'),
      purchase_value: optional(form, 'purchase_value'),
      salvage_percent: num(form, 'salvage_percent'),
      useful_life_months: num(form, 'useful_life_months'),
    },
    'asset',
  );
}
export async function deleteAssetAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/assets/${encodeURIComponent(id)}`, 'DELETE', undefined, 'asset');
}
export async function logMaintenanceAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(
    slug,
    `/assets/${encodeURIComponent(str(form, 'asset_id'))}/maintenance`,
    'POST',
    { performed_on: str(form, 'performed_on'), kind: str(form, 'kind') || 'SERVICE', cost: optional(form, 'cost'), next_due_on: optional(form, 'next_due_on'), notes: optional(form, 'notes') },
    'maintenance',
  );
}

export async function addDepartmentAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, '/departments', 'POST', { name: str(form, 'name'), branch_id: optional(form, 'branch_id') }, 'department');
}
export async function deleteDepartmentAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/departments/${encodeURIComponent(id)}`, 'DELETE', undefined, 'department');
}

export async function addStaffAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(
    slug,
    '/staff',
    'POST',
    { branch_id: str(form, 'branch_id'), department_id: optional(form, 'department_id'), full_name: str(form, 'full_name'), job_title: optional(form, 'job_title'), phone: optional(form, 'phone'), email: optional(form, 'email') },
    'staff',
  );
}
export async function deleteStaffAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/staff/${encodeURIComponent(id)}`, 'DELETE', undefined, 'staff');
}

export async function saveMemberAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, '/members', 'PUT', { email: str(form, 'email'), role: str(form, 'role'), branch_id: optional(form, 'branch_id') }, 'member');
}
export async function removeMemberAction(slug: string, userId: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/members/${encodeURIComponent(userId)}`, 'DELETE', undefined, 'member');
}

const MAX_SHEET = 2 * 1024 * 1024;

export async function importAssetsAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  const t = await token(slug);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: MESSAGES.FILE_REQUIRED };
  if (file.size > MAX_SHEET) return { error: MESSAGES.PAYLOAD_TOO_LARGE };
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const r = await api<{ created: number }>(slug, '/admin/institute/assets-import', { method: 'POST', token: t, raw: { data, contentType: 'application/octet-stream' } });
    revalidatePath(`/${slug}/institute`);
    return { done: `تم استيراد ${r.created} أصلاً.` };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'IMPORT_INVALID') {
      return { error: MESSAGES.IMPORT_INVALID, rowErrors: (err.details as unknown as { row: number; message: string }[] | undefined) ?? [] };
    }
    return describe(err);
  }
}

/** Saudi time (UTC+3, no daylight saving): "2026-11-10" + "09:00" becomes an instant with an explicit offset. */
const riyadh = (date: string, time: string): string => `${date}T${time}:00+03:00`;

export async function addProgramAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, '/programs', 'POST', { branch_id: str(form, 'branch_id'), name: str(form, 'name'), description: optional(form, 'description'), admission_requirements: optional(form, 'admission_requirements'), fee: optional(form, 'fee') }, 'program');
}
export async function deleteProgramAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/programs/${encodeURIComponent(id)}`, 'DELETE', undefined, 'program');
}
export async function addLevelAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, `/programs/${encodeURIComponent(str(form, 'program_id'))}/levels`, 'POST', { name: str(form, 'name'), sort_order: num(form, 'sort_order') }, 'program');
}
export async function deleteLevelAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/levels/${encodeURIComponent(id)}`, 'DELETE', undefined, 'program');
}
export async function addSubjectAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, `/levels/${encodeURIComponent(str(form, 'level_id'))}/subjects`, 'POST', { name: str(form, 'name'), hours: num(form, 'hours'), fee: optional(form, 'fee') }, 'program');
}
export async function deleteSubjectAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/subjects/${encodeURIComponent(id)}`, 'DELETE', undefined, 'program');
}

export async function addInstructorAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  return save(slug, '/instructors', 'POST', { branch_id: str(form, 'branch_id'), full_name: str(form, 'full_name'), phone: optional(form, 'phone'), email: optional(form, 'email'), qualifications: optional(form, 'qualifications'), hourly_rate: optional(form, 'hourly_rate') }, 'instructor');
}
export async function deleteInstructorAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/instructors/${encodeURIComponent(id)}`, 'DELETE', undefined, 'instructor');
}

export async function addStudentAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  // The level select carries "programId|levelId" so the two always travel together.
  const track = str(form, 'track').split('|');
  return save(
    slug,
    '/students',
    'POST',
    { branch_id: str(form, 'branch_id'), full_name: str(form, 'full_name'), phone: optional(form, 'phone'), email: optional(form, 'email'), program_id: track[0] || null, level_id: track[1] || null, enrolled_on: optional(form, 'enrolled_on') },
    'student',
  );
}
export async function deleteStudentAction(slug: string, id: string, _prev: InstState): Promise<InstState> {
  return save(slug, `/students/${encodeURIComponent(id)}`, 'DELETE', undefined, 'student');
}

export async function scheduleSessionAction(slug: string, _prev: InstState, form: FormData): Promise<InstState> {
  const date = str(form, 'date');
  return save(
    slug,
    '/sessions',
    'POST',
    { subject_id: str(form, 'subject_id'), room_id: str(form, 'room_id'), instructor_id: str(form, 'instructor_id'), starts_at: riyadh(date, str(form, 'from')), ends_at: riyadh(date, str(form, 'to')), notes: optional(form, 'notes') },
    'session',
  );
}
/** Cancel or mark as held: re-sends the session's own room, instructor and time (the API needs the full record). */
export async function setSessionStatusAction(slug: string, s: { id: string; room_id: string; instructor_id: string; starts_at: string; ends_at: string }, status: 'HELD' | 'CANCELLED', _prev: InstState): Promise<InstState> {
  return save(slug, `/sessions/${encodeURIComponent(s.id)}`, 'PUT', { room_id: s.room_id, instructor_id: s.instructor_id, starts_at: s.starts_at, ends_at: s.ends_at, status }, 'session');
}

export async function saveAttendanceAction(slug: string, sessionId: string, _prev: InstState, form: FormData): Promise<InstState> {
  const records: { student_id: string; status: string }[] = [];
  for (const [k, v] of form.entries()) if (k.startsWith('att_') && typeof v === 'string' && v) records.push({ student_id: k.slice(4), status: v });
  if (records.length === 0) return { error: 'اختر حالة طالب واحد على الأقل.' };
  const t = await token(slug);
  try {
    await api(slug, `/admin/institute/sessions/${encodeURIComponent(sessionId)}/attendance`, { method: 'PUT', token: t, body: { records } });
  } catch (err) {
    return describe(err);
  }
  revalidatePath(`/${slug}/institute/session/${sessionId}`);
  return { done: `تم حفظ حضور ${records.length} طالباً.` };
}
