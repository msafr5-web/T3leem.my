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
  INVALID_PERIOD: 'تاريخ الاستحقاق التالي يجب ألا يسبق تاريخ العمل.',
  FILE_REQUIRED: 'اختر ملف Excel أو CSV.',
  IMPORT_INVALID: 'في الملف صفوف لا يمكن استيرادها، ولم يُستورد شيء. صحّحها وأعد الرفع.',
  PAYLOAD_TOO_LARGE: 'حجم الملف أكبر من المسموح (٢ ميغابايت).',
  VALIDATION_FAILED: 'تحقق من الحقول: القيم غير صحيحة.',
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
