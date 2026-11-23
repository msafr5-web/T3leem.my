import ExcelJS from 'exceljs';
import type { AttendanceStatus } from './attendance.engine';
import type { CourseReport } from './attendance.service';

const LABEL: Record<AttendanceStatus, string> = { PRESENT: 'حاضر', LATE: 'متأخر', ABSENT: 'غائب', PENDING: '—' };
const riyadh = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh' });

/** The attendance sheet of one course: a row per trainee, a column per session, then the attendance percentage and the result. */
export async function buildAttendanceWorkbook(report: CourseReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('الحضور', { views: [{ rightToLeft: true, state: 'frozen', xSplit: 1, ySplit: 2 }] });
  sheet.addRow([`${report.course.title}: الحضور والانصراف`]);
  sheet.getRow(1).font = { bold: true, size: 13 };
  sheet.addRow(['المتدرب', ...report.sessions.map((s) => `${s.title} (${riyadh.format(s.startsAt)})`), 'حضر', 'متأخر', 'غاب', 'النسبة %', 'النتيجة']);
  sheet.getRow(2).font = { bold: true };
  for (const t of report.trainees) {
    const result = t.summary.passes === null ? '—' : t.summary.passes ? 'يجتاز' : 'لا يجتاز';
    sheet.addRow([t.name, ...report.sessions.map((s) => LABEL[t.statuses[s.ref] ?? 'PENDING']), t.summary.attended, t.summary.late, t.summary.absent, t.summary.percent ?? '', result]);
  }
  sheet.getColumn(1).width = 28;
  report.sessions.forEach((_s, i) => (sheet.getColumn(i + 2).width = 22));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
