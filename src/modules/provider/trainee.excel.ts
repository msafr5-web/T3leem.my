import ExcelJS from 'exceljs';
import { cellText, headerKey, loadWorkbook, type RowError } from '../lms/quiz/quiz.excel';

/** One employee as entered by the academy's admin (form or spreadsheet), already cleaned. */
export interface TraineeDraft {
  fullName: string;
  email: string;
  /** International format (+9665XXXXXXXX), or null. */
  phone: string | null;
  employeeNo: string | null;
}

export interface TraineeParseResult {
  trainees: TraineeDraft[];
  errors: RowError[];
}

export const TRAINEE_LIMITS = {
  maxRows: 500,
  maxFileBytes: 1024 * 1024,
  name: { min: 3, max: 120 },
  maxEmployeeNo: 40,
} as const;

const COLUMNS = ['Full_Name', 'Email', 'Phone', 'Employee_No'] as const;
type Column = (typeof COLUMNS)[number];

/** Header spellings accepted on import (case, spaces, underscores and dashes are ignored). */
const HEADER_ALIASES: Record<string, Column> = {
  fullname: 'Full_Name',
  name: 'Full_Name',
  traineename: 'Full_Name',
  employeename: 'Full_Name',
  'الاسم': 'Full_Name',
  'اسمالمتدرب': 'Full_Name',
  'اسمالموظف': 'Full_Name',
  email: 'Email',
  mail: 'Email',
  emailaddress: 'Email',
  'البريد': 'Email',
  'البريدالإلكتروني': 'Email',
  phone: 'Phone',
  mobile: 'Phone',
  'الجوال': 'Phone',
  'رقمالجوال': 'Phone',
  employeeno: 'Employee_No',
  employeenumber: 'Employee_No',
  employeeid: 'Employee_No',
  staffno: 'Employee_No',
  'الرقمالوظيفي': 'Employee_No',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNATIONAL = /^\+[1-9][0-9]{8,14}$/;

/**
 * Turns what people actually type in Excel into +966 format: 05XXXXXXXX, 5XXXXXXXX, 966..., 00966..., with spaces or dashes.
 * Returns null when it cannot be made into a valid international number.
 */
export function normalizePhone(raw: string): string | null {
  // Arabic-Indic digits -> Latin, then drop spaces, dashes, dots and brackets.
  const latin = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s\-.()]/g, '');
  let s = latin;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  else if (/^05\d{8}$/.test(s)) s = `+966${s.slice(1)}`;
  else if (/^5\d{8}$/.test(s)) s = `+966${s}`;
  else if (/^966\d{9}$/.test(s)) s = `+${s}`;
  return INTERNATIONAL.test(s) ? s : null;
}

/**
 * Validates one employee. Shared by the spreadsheet import and the JSON endpoint so both apply the same rules.
 * Returns the cleaned draft, or an Arabic message saying what is wrong (shown to the admin next to the row).
 */
export function cleanTrainee(input: { fullName: string; email: string; phone?: string | null; employeeNo?: string | null }): TraineeDraft | string {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (fullName.length < TRAINEE_LIMITS.name.min || fullName.length > TRAINEE_LIMITS.name.max) {
    return `الاسم يجب أن يكون بين ${TRAINEE_LIMITS.name.min} و${TRAINEE_LIMITS.name.max} حرفاً.`;
  }
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return 'البريد الإلكتروني غير صالح.';
  const phoneRaw = input.phone?.trim() ?? '';
  let phone: string | null = null;
  if (phoneRaw !== '') {
    phone = normalizePhone(phoneRaw);
    if (!phone) return 'رقم الجوال غير صالح. مثال: 0551234567 أو +966551234567.';
  }
  const employeeNo = input.employeeNo?.trim() ?? '';
  if (employeeNo.length > TRAINEE_LIMITS.maxEmployeeNo) return `الرقم الوظيفي أطول من ${TRAINEE_LIMITS.maxEmployeeNo} حرفاً.`;
  return { fullName, email, phone, employeeNo: employeeNo === '' ? null : employeeNo };
}

/**
 * Reports duplicates INSIDE one batch (same e-mail, phone or employee number twice) so a typo is caught before
 * anything is written. The first occurrence wins; later ones become errors on their own row.
 */
export function dedupeBatch(drafts: { row: number; draft: TraineeDraft }[]): { trainees: TraineeDraft[]; errors: RowError[] } {
  const seen = { email: new Map<string, number>(), phone: new Map<string, number>(), emp: new Map<string, number>() };
  const trainees: TraineeDraft[] = [];
  const errors: RowError[] = [];
  for (const { row, draft } of drafts) {
    const clash =
      (seen.email.has(draft.email) && ['البريد', seen.email.get(draft.email)] as const) ||
      (draft.phone && seen.phone.has(draft.phone) && ['الجوال', seen.phone.get(draft.phone)] as const) ||
      (draft.employeeNo && seen.emp.has(draft.employeeNo) && ['الرقم الوظيفي', seen.emp.get(draft.employeeNo)] as const) ||
      null;
    if (clash) {
      errors.push({ row, message: `${clash[0]} مكرر في الملف (مذكور في الصف ${clash[1]}).` });
      continue;
    }
    seen.email.set(draft.email, row);
    if (draft.phone) seen.phone.set(draft.phone, row);
    if (draft.employeeNo) seen.emp.set(draft.employeeNo, row);
    trainees.push(draft);
  }
  return { trainees, errors };
}

/** Parses and validates an .xlsx (or .csv) list of employees. Returns every valid row AND every row error. */
export async function parseTraineeSheet(file: Buffer): Promise<TraineeParseResult> {
  if (file.length === 0) return { trainees: [], errors: [{ row: 0, message: 'الملف فارغ.' }] };
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(file);
  } catch {
    return { trainees: [], errors: [{ row: 0, message: 'تعذّرت قراءة الملف. ارفع ملف Excel (‎.xlsx) أو CSV بصيغة UTF-8.' }] };
  }
  const sheet = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return { trainees: [], errors: [{ row: 0, message: 'لا توجد أوراق في الملف.' }] };

  const columnOf = new Map<Column, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const c = HEADER_ALIASES[headerKey(cellText(cell))];
    if (c && !columnOf.has(c)) columnOf.set(c, col);
  });
  const missing = (['Full_Name', 'Email'] as const).filter((c) => !columnOf.has(c));
  if (missing.length > 0) {
    return { trainees: [], errors: [{ row: 1, message: `أعمدة ناقصة في الصف الأول: ${missing.join('، ')}. استخدم قالب الاستيراد.` }] };
  }
  const get = (row: ExcelJS.Row, c: Column) => {
    const i = columnOf.get(c);
    return i ? cellText(row.getCell(i)) : '';
  };

  const drafts: { row: number; draft: TraineeDraft }[] = [];
  const errors: RowError[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const fullName = get(row, 'Full_Name');
    const email = get(row, 'Email');
    const phone = get(row, 'Phone');
    const employeeNo = get(row, 'Employee_No');
    if (!fullName && !email && !phone && !employeeNo) continue; // blank line

    if (drafts.length + errors.length >= TRAINEE_LIMITS.maxRows + 50) {
      errors.push({ row: r, message: `الحد الأقصى ${TRAINEE_LIMITS.maxRows} موظفاً في الملف الواحد.` });
      break;
    }
    const cleaned = cleanTrainee({ fullName, email, phone, employeeNo });
    if (typeof cleaned === 'string') errors.push({ row: r, message: cleaned });
    else drafts.push({ row: r, draft: cleaned });
  }
  if (drafts.length > TRAINEE_LIMITS.maxRows) {
    errors.push({ row: 0, message: `الملف يحتوي ${drafts.length} موظفاً؛ الحد الأقصى ${TRAINEE_LIMITS.maxRows}. قسّمه إلى ملفين.` });
  }

  const deduped = dedupeBatch(drafts);
  errors.push(...deduped.errors);
  if (deduped.trainees.length === 0 && errors.length === 0) errors.push({ row: 0, message: 'لا توجد صفوف بيانات في الملف.' });
  return { trainees: deduped.trainees, errors: errors.sort((a, b) => a.row - b.row) };
}

/** An empty import template with one example row, so admins see the expected columns. */
export async function buildTraineeTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Trainees', { views: [{ rightToLeft: true }] });
  sheet.addRow([...COLUMNS]);
  sheet.addRow(['محمد أحمد العتيبي', 'mohammed@company.example', '0551234567', 'E-10025']);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 28 }, { width: 32 }, { width: 18 }, { width: 18 }];
  // Phone and staff numbers must stay text: Excel would otherwise drop the leading zero.
  sheet.getColumn(3).numFmt = '@';
  sheet.getColumn(4).numFmt = '@';
  return Buffer.from(await wb.xlsx.writeBuffer());
}
