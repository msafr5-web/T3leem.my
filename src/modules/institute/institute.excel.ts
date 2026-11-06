import ExcelJS from 'exceljs';
import { cellText, headerKey, loadWorkbook } from '../lms/quiz/quiz.excel';
import type { AssetInput, AssetRow, AssetStatus, BranchRow, RoomRow } from './institute.repository';

export const ASSET_SHEET_LIMITS = { maxRows: 2000, maxFileBytes: 2 * 1024 * 1024 } as const;

export interface RowError {
  row: number;
  message: string;
}

const COLUMNS = ['Name', 'Branch', 'Room', 'Category', 'Serial', 'Purchase_Date', 'Purchase_Value', 'Salvage_Percent', 'Useful_Life_Months', 'Status'] as const;
type Column = (typeof COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  ...Object.fromEntries(COLUMNS.map((c) => [headerKey(c), c])),
  // Arabic headers, so a sheet kept in Arabic imports too.
  [headerKey('الاسم')]: 'Name',
  [headerKey('الفرع')]: 'Branch',
  [headerKey('القاعة')]: 'Room',
  [headerKey('التصنيف')]: 'Category',
  [headerKey('الرقم التسلسلي')]: 'Serial',
  [headerKey('تاريخ الشراء')]: 'Purchase_Date',
  [headerKey('قيمة الشراء')]: 'Purchase_Value',
  [headerKey('القيمة المتبقية')]: 'Salvage_Percent',
  [headerKey('العمر النافع')]: 'Useful_Life_Months',
  [headerKey('الحالة')]: 'Status',
};

const STATUSES: Record<string, AssetStatus> = {
  IN_SERVICE: 'IN_SERVICE',
  MAINTENANCE: 'MAINTENANCE',
  RETIRED: 'RETIRED',
  'في الخدمة': 'IN_SERVICE',
  'في الصيانة': 'MAINTENANCE',
  'خارج الخدمة': 'RETIRED',
};

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The branches and rooms the importing user may use (already limited to their scope), matched by name. */
export interface Lookup {
  branches: BranchRow[];
  rooms: RoomRow[];
}

export async function parseAssetSheet(file: Buffer, lookup: Lookup): Promise<{ assets: AssetInput[]; errors: RowError[] }> {
  const fail = (message: string, row = 0) => ({ assets: [], errors: [{ row, message }] });
  if (file.length === 0) return fail('الملف فارغ.');
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(file);
  } catch {
    return fail('تعذّرت قراءة الملف. ارفع ملف Excel (‎.xlsx) أو CSV بصيغة UTF-8.');
  }
  const sheet = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return fail('لا توجد أوراق في الملف.');
  if (sheet.rowCount - 1 > ASSET_SHEET_LIMITS.maxRows) return fail(`الحد الأقصى ${ASSET_SHEET_LIMITS.maxRows} صفاً في الملف الواحد.`);

  const columnOf = new Map<Column, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const c = ALIASES[headerKey(cellText(cell))];
    if (c && !columnOf.has(c)) columnOf.set(c, col);
  });
  const missing = (['Name', 'Branch'] as Column[]).filter((c) => !columnOf.has(c));
  if (missing.length > 0) return fail(`أعمدة ناقصة في الصف الأول: ${missing.join('، ')}. استخدم القالب.`, 1);
  const get = (row: ExcelJS.Row, c: Column) => {
    const i = columnOf.get(c);
    return i ? cellText(row.getCell(i)).trim() : '';
  };

  const branchByName = new Map(lookup.branches.map((b) => [b.name, b]));
  const roomKey = (branchId: string, name: string) => `${branchId}\u0000${name}`;
  const roomByName = new Map(lookup.rooms.map((r) => [roomKey(r.branchId, r.name), r]));

  const assets: AssetInput[] = [];
  const errors: RowError[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = get(row, 'Name');
    const branchName = get(row, 'Branch');
    if (!name && !branchName) continue; // blank line
    const bad = (message: string) => errors.push({ row: r, message });
    if (!name) {
      bad('اسم الأصل مطلوب.');
      continue;
    }
    const branch = branchByName.get(branchName);
    if (!branch) {
      bad(`الفرع «${branchName}» غير موجود أو خارج صلاحيتك.`);
      continue;
    }
    const roomName = get(row, 'Room');
    const room = roomName ? roomByName.get(roomKey(branch.id, roomName)) : undefined;
    if (roomName && !room) {
      bad(`القاعة «${roomName}» غير موجودة في فرع ${branch.name}.`);
      continue;
    }
    const date = get(row, 'Purchase_Date');
    if (date && (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      bad('تاريخ الشراء يجب أن يكون بصيغة YYYY-MM-DD.');
      continue;
    }
    const value = get(row, 'Purchase_Value');
    if (value && !MONEY.test(value)) {
      bad('قيمة الشراء رقم موجب بخانتين عشريتين كحد أقصى.');
      continue;
    }
    const salvage = get(row, 'Salvage_Percent');
    if (salvage && !(Number(salvage) >= 0 && Number(salvage) <= 100)) {
      bad('القيمة المتبقية بين 0 و100.');
      continue;
    }
    const life = get(row, 'Useful_Life_Months');
    if (life && !(Number.isInteger(Number(life)) && Number(life) >= 1 && Number(life) <= 1200)) {
      bad('العمر النافع عدد صحيح من 1 إلى 1200 شهر.');
      continue;
    }
    const statusText = get(row, 'Status');
    const status = statusText ? STATUSES[statusText] : 'IN_SERVICE';
    if (!status) {
      bad('الحالة: IN_SERVICE أو MAINTENANCE أو RETIRED.');
      continue;
    }
    assets.push({
      branchId: branch.id,
      roomId: room?.id ?? null,
      name,
      category: get(row, 'Category') || null,
      serialNo: get(row, 'Serial') || null,
      purchaseDate: date || null,
      purchaseValue: value ? Number(value).toFixed(2) : '0.00',
      salvagePercent: salvage ? Number(salvage).toFixed(2) : '10.00',
      usefulLifeMonths: life ? Number(life) : null,
      status,
      notes: null,
    });
  }
  if (assets.length === 0 && errors.length === 0) return fail('لا توجد صفوف للاستيراد.');
  return { assets, errors };
}

export interface ExportAsset extends Partial<Pick<AssetRow, 'purchaseValue' | 'salvagePercent' | 'usefulLifeMonths'>> {
  name: string;
  branch: string;
  room: string;
  category: string | null;
  serialNo: string | null;
  purchaseDate: string | null;
  status: AssetStatus;
}

/** Template (one sample row) or export. Money columns are left out for roles that may not see them. */
export async function buildAssetWorkbook(assets: ExportAsset[], opts: { template: boolean; withValues: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 't3leem.my';
  const sheet = wb.addWorksheet('Assets', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = COLUMNS.filter((c) => opts.withValues || !['Purchase_Value', 'Salvage_Percent', 'Useful_Life_Months'].includes(c));
  sheet.columns = cols.map((c) => ({ header: c, key: c, width: c === 'Name' ? 30 : 18 }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163051' } };

  const rows: ExportAsset[] = opts.template
    ? [{ name: 'جهاز حاسب', branch: 'الرياض', room: 'معمل 1', category: 'IT', serialNo: 'SN-0001', purchaseDate: '2026-01-15', purchaseValue: '4500.00', salvagePercent: '10.00', usefulLifeMonths: 36, status: 'IN_SERVICE' }]
    : assets;
  for (const a of rows) {
    sheet.addRow({
      Name: a.name,
      Branch: a.branch,
      Room: a.room,
      Category: a.category ?? '',
      Serial: a.serialNo ?? '',
      Purchase_Date: a.purchaseDate ?? '',
      Purchase_Value: a.purchaseValue ?? '',
      Salvage_Percent: a.salvagePercent ?? '',
      Useful_Life_Months: a.usefulLifeMonths ?? '',
      Status: a.status,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
