import ExcelJS from 'exceljs';
import { cellText, headerKey, loadWorkbook } from '../quiz/quiz.excel';

export const HEALTH_LIMITS = {
  maxQuestions: 2000,
  maxFileBytes: 3 * 1024 * 1024,
  maxCodeLength: 40,
  maxBodyLength: 1000,
  maxOptionLength: 300,
  maxExplanationLength: 1500,
  options: { min: 2, max: 6 },
} as const;

export interface HealthQuestionInput {
  code: string;
  body: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  active: boolean;
}

/** A parsed sheet row: the sector is still a name / slug the service resolves. */
export interface ParsedHealthQuestion extends HealthQuestionInput {
  sectorRef: string;
  /** Sheet row, for error messages about the sector lookup. */
  row: number;
}

export interface ExportHealthQuestion extends HealthQuestionInput {
  sectorName: string;
}

export interface RowError {
  row: number;
  message: string;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ARABIC_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

type OptionColumn = 'Option_A' | 'Option_B' | 'Option_C' | 'Option_D' | 'Option_E' | 'Option_F';
type Column = 'Question_ID' | 'Sector' | 'Question_Text' | 'Correct' | 'Explanation' | 'Active' | OptionColumn;

const ALIASES: Record<string, Column> = {
  questionid: 'Question_ID', id: 'Question_ID', code: 'Question_ID', الرقم: 'Question_ID', رقمالسؤال: 'Question_ID',
  sector: 'Sector', category: 'Sector', القطاع: 'Sector',
  questiontext: 'Question_Text', question: 'Question_Text', السؤال: 'Question_Text', نصالسؤال: 'Question_Text',
  correct: 'Correct', correctanswer: 'Correct', answer: 'Correct', الإجابةالصحيحة: 'Correct', الاجابةالصحيحة: 'Correct',
  explanation: 'Explanation', الشرح: 'Explanation', التفسير: 'Explanation',
  active: 'Active', فعال: 'Active', مفعل: 'Active',
  optiona: 'Option_A', الخيارأ: 'Option_A',
  optionb: 'Option_B', الخيارب: 'Option_B',
  optionc: 'Option_C', الخيارج: 'Option_C',
  optiond: 'Option_D', الخيارد: 'Option_D',
  optione: 'Option_E',
  optionf: 'Option_F',
};

const OPTION_COLUMNS: OptionColumn[] = ['Option_A', 'Option_B', 'Option_C', 'Option_D', 'Option_E', 'Option_F'];

/** Correct = the exact text of an option, a letter (A-F or Arabic), or a 1-6 number. */
function resolveCorrect(options: string[], ref: string): number {
  const t = ref.trim();
  if (!t) return -1;
  const byText = options.findIndex((o) => o === t);
  if (byText >= 0) return byText;
  const letter = LETTERS.indexOf(t.toUpperCase());
  if (letter >= 0 && letter < options.length) return letter;
  const arabic = ARABIC_LETTERS.indexOf(t);
  if (arabic >= 0 && arabic < options.length) return arabic;
  if (/^[1-6]$/.test(t) && Number(t) <= options.length) return Number(t) - 1;
  return -1;
}

const YES = new Set(['yes', 'y', 'true', '1', 'نعم', 'مفعل']);
const NO = new Set(['no', 'n', 'false', '0', 'لا', 'معطل']);

export async function parseHealthSheet(file: Buffer): Promise<{ questions: ParsedHealthQuestion[]; errors: RowError[] }> {
  const empty = (message: string, row = 0) => ({ questions: [], errors: [{ row, message }] });
  if (file.length === 0) return empty('الملف فارغ.');
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(file);
  } catch {
    return empty('تعذّرت قراءة الملف. ارفع ملف Excel (‎.xlsx) أو CSV بصيغة UTF-8.');
  }
  const sheet = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return empty('لا توجد أوراق في الملف.');

  const columnOf = new Map<Column, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const c = ALIASES[headerKey(cellText(cell))];
    if (c && !columnOf.has(c)) columnOf.set(c, col);
  });
  const required: Column[] = ['Question_ID', 'Sector', 'Question_Text', 'Option_A', 'Option_B', 'Correct'];
  const missing = required.filter((c) => !columnOf.has(c));
  if (missing.length > 0) return empty(`أعمدة ناقصة في الصف الأول: ${missing.join('، ')}. استخدم قالب الاستيراد.`, 1);

  const get = (row: ExcelJS.Row, c: Column) => {
    const i = columnOf.get(c);
    return i ? cellText(row.getCell(i)) : '';
  };

  const questions: ParsedHealthQuestion[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = get(row, 'Question_ID');
    const body = get(row, 'Question_Text');
    if (!code && !body) continue;
    if (questions.length + errors.length >= HEALTH_LIMITS.maxQuestions + 50) {
      errors.push({ row: r, message: `الحد الأقصى ${HEALTH_LIMITS.maxQuestions} سؤال في الملف.` });
      break;
    }
    const fail = (message: string) => errors.push({ row: r, message });

    if (!code) { fail('رقم السؤال (Question_ID) مطلوب.'); continue; }
    if (code.length > HEALTH_LIMITS.maxCodeLength) { fail(`رقم السؤال أطول من ${HEALTH_LIMITS.maxCodeLength} حرفاً.`); continue; }
    if (seen.has(code.toLowerCase())) { fail(`رقم السؤال «${code}» مكرر في الملف.`); continue; }
    seen.add(code.toLowerCase());
    const sectorRef = get(row, 'Sector');
    if (!sectorRef) { fail('القطاع (Sector) مطلوب.'); continue; }
    if (!body) { fail('نص السؤال مطلوب.'); continue; }
    if (body.length > HEALTH_LIMITS.maxBodyLength) { fail(`نص السؤال أطول من ${HEALTH_LIMITS.maxBodyLength} حرفاً.`); continue; }

    const options = OPTION_COLUMNS.map((c) => get(row, c)).filter((o) => o !== '');
    if (options.length < HEALTH_LIMITS.options.min) { fail('يلزم خياران على الأقل.'); continue; }
    if (options.some((o) => o.length > HEALTH_LIMITS.maxOptionLength)) { fail(`أحد الخيارات أطول من ${HEALTH_LIMITS.maxOptionLength} حرفاً.`); continue; }
    if (new Set(options).size !== options.length) { fail('الخيارات يجب ألا تتكرر.'); continue; }
    const correctIndex = resolveCorrect(options, get(row, 'Correct'));
    if (correctIndex < 0) { fail('الإجابة الصحيحة يجب أن تكون نص أحد الخيارات أو حرفه (A-F) أو رقمه.'); continue; }

    const explanation = get(row, 'Explanation');
    if (explanation.length > HEALTH_LIMITS.maxExplanationLength) { fail(`الشرح أطول من ${HEALTH_LIMITS.maxExplanationLength} حرفاً.`); continue; }
    const activeRaw = get(row, 'Active').toLowerCase();
    if (activeRaw && !YES.has(activeRaw) && !NO.has(activeRaw)) { fail('عمود Active يجب أن يكون Yes أو No.'); continue; }

    questions.push({ row: r, code, sectorRef, body, options, correctIndex, explanation, active: activeRaw ? YES.has(activeRaw) : true });
  }
  return { questions, errors };
}

const SAMPLES: ExportHealthQuestion[] = [
  {
    code: 'EX_001',
    sectorName: 'الأغذية والمطاعم',
    body: 'متى يجب على عامل الأغذية غسل يديه بالماء والصابون؟',
    options: ['بداية الدوام فقط', 'بعد استخدام دورة المياه ولمس النفايات وقبل تحضير الطعام', 'نهاية اليوم', 'لا داعي بوجود القفازات'],
    correctIndex: 1,
    explanation: 'غسل اليدين ضروري لمنع التلوث الميكروبي.',
    active: true,
  },
];

export async function buildHealthWorkbook(questions: ExportHealthQuestion[], template: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 't3leem.my';
  const sheet = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Question_ID', key: 'code', width: 14 },
    { header: 'Sector', key: 'sector', width: 22 },
    { header: 'Question_Text', key: 'body', width: 60 },
    { header: 'Option_A', key: 'a', width: 34 },
    { header: 'Option_B', key: 'b', width: 34 },
    { header: 'Option_C', key: 'c', width: 34 },
    { header: 'Option_D', key: 'd', width: 34 },
    { header: 'Option_E', key: 'e', width: 24 },
    { header: 'Option_F', key: 'f', width: 24 },
    { header: 'Correct', key: 'correct', width: 10 },
    { header: 'Explanation', key: 'explanation', width: 50 },
    { header: 'Active', key: 'active', width: 9 },
  ];
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E5A4A' } };

  const rows = template ? SAMPLES : questions;
  for (const q of rows) {
    sheet.addRow({
      code: q.code,
      sector: q.sectorName,
      body: q.body,
      a: q.options[0],
      b: q.options[1],
      c: q.options[2],
      d: q.options[3],
      e: q.options[4],
      f: q.options[5],
      correct: LETTERS[q.correctIndex],
      explanation: q.explanation,
      active: q.active ? 'Yes' : 'No',
    });
  }
  const last = Math.max(rows.length + 1, 200);
  for (let r = 2; r <= last; r++) {
    sheet.getCell(`J${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"A,B,C,D,E,F"'] };
    sheet.getCell(`L${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
  }

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    'تعليمات تعبئة بنك أسئلة الشهادات الصحية',
    '• Question_ID: رقم فريد لكل سؤال. عند إعادة الاستيراد يُحدَّث السؤال الذي له الرقم نفسه، واستخدم أرقاماً جديدة للأسئلة الجديدة.',
    '• Sector: اسم القطاع كما هو في الموقع (أو رمزه). يجب إنشاء القطاع الجديد من الموقع أولاً.',
    '• Question_Text: نص السؤال.',
    '• Option_A … Option_F: من خيارين إلى ستة خيارات (اترك الأعمدة الزائدة فارغة). يجب ألا تتكرر الخيارات.',
    '• Correct: حرف الإجابة الصحيحة (A-F) أو نصها.',
    '• Explanation: شرح يظهر للمتدرب بعد الإجابة (اختياري).',
    '• Active: Yes ليظهر السؤال للمتدربين (الافتراضي)، أو No لإخفائه دون حذفه.',
    'عند الاستيراد: إن وُجد أي خطأ في أي صف لا يُستورد شيء، ويُعرض لك رقم الصف وسببه.',
  ].forEach((line, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) cell.font = { bold: true, size: 14 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
