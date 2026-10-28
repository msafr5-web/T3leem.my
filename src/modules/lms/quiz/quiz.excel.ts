import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export type QuestionType = 'MCQ' | 'TEXT';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/** One validated row of the question-bank sheet. `day` is the 1-based day number, null = whole course. */
export interface ParsedQuestion {
  code: string;
  body: string;
  type: QuestionType;
  options: string[];
  correctAnswer: string;
  difficulty: Difficulty;
  day: number | null;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  errors: RowError[];
}

export const QUIZ_LIMITS = {
  maxQuestions: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  options: { min: 2, max: 6 },
  maxOptionLength: 300,
  maxBodyLength: 2000,
  maxCodeLength: 64,
} as const;

const COLUMNS = ['Question_ID', 'Question_Text', 'Question_Type', 'Options_List', 'Correct_Answer', 'Difficulty_Level', 'Day'] as const;
type Column = (typeof COLUMNS)[number];

/** Header spellings accepted on import (case, spaces and underscores are ignored). */
const HEADER_ALIASES: Record<string, Column> = {
  questionid: 'Question_ID',
  id: 'Question_ID',
  questiontext: 'Question_Text',
  question: 'Question_Text',
  questiontype: 'Question_Type',
  type: 'Question_Type',
  optionslist: 'Options_List',
  options: 'Options_List',
  correctanswer: 'Correct_Answer',
  answer: 'Correct_Answer',
  difficultylevel: 'Difficulty_Level',
  difficulty: 'Difficulty_Level',
  day: 'Day',
};

const headerKey = (raw: string) => raw.replace(/^﻿/, '').toLowerCase().replace(/[\s_-]+/g, '');

/** Cell → trimmed string, whatever shape ExcelJS gives (rich text, formula result, hyperlink, number). */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return String(v.result ?? '').trim();
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text ?? '').trim();
    return '';
  }
  return String(v).trim();
}

const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

async function loadWorkbook(file: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (isZip(file)) await wb.xlsx.load(file as unknown as ExcelJS.Buffer);
  else await wb.csv.read(Readable.from(file.toString('utf8')));
  return wb;
}

/** A | b | c, or one per line, or a, b, c (Arabic comma too). Pipe/newline win so options can hold commas. */
function splitOptions(raw: string): string[] {
  const parts = /[|\n]/.test(raw) ? raw.split(/[|\n]/) : raw.split(/[,،]/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TYPES: Record<string, QuestionType> = { mcq: 'MCQ', multiplechoice: 'MCQ', text: 'TEXT', textinput: 'TEXT', essay: 'TEXT' };
const LEVELS: Record<string, Difficulty> = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Parses and validates an .xlsx (or .csv) question bank. All-or-nothing is the caller's job:
 * this returns every valid question AND every row error, so the supervisor can fix the whole
 * sheet in one pass. `dayCount` bounds the optional Day column.
 */
export async function parseQuestionSheet(file: Buffer, dayCount: number): Promise<ParseResult> {
  if (file.length === 0) return { questions: [], errors: [{ row: 0, message: 'الملف فارغ.' }] };
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(file);
  } catch {
    return { questions: [], errors: [{ row: 0, message: 'تعذّرت قراءة الملف. ارفع ملف Excel (‎.xlsx) أو CSV بصيغة UTF-8.' }] };
  }
  const sheet = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return { questions: [], errors: [{ row: 0, message: 'لا توجد أوراق في الملف.' }] };

  const columnOf = new Map<Column, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const c = HEADER_ALIASES[headerKey(cellText(cell))];
    if (c && !columnOf.has(c)) columnOf.set(c, col);
  });
  const required: Column[] = ['Question_ID', 'Question_Text', 'Question_Type'];
  const missing = required.filter((c) => !columnOf.has(c));
  if (missing.length > 0) {
    return { questions: [], errors: [{ row: 1, message: `أعمدة ناقصة في الصف الأول: ${missing.join('، ')}. استخدم قالب الاستيراد.` }] };
  }

  const questions: ParsedQuestion[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const get = (row: ExcelJS.Row, c: Column) => {
    const i = columnOf.get(c);
    return i ? cellText(row.getCell(i)) : '';
  };

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = get(row, 'Question_ID');
    const body = get(row, 'Question_Text');
    const typeRaw = get(row, 'Question_Type');
    if (!code && !body && !typeRaw) continue; // blank line

    if (questions.length + errors.length >= QUIZ_LIMITS.maxQuestions + 50) {
      errors.push({ row: r, message: `الحد الأقصى ${QUIZ_LIMITS.maxQuestions} سؤال في الملف.` });
      break;
    }
    const fail = (message: string) => errors.push({ row: r, message });

    if (!code) { fail('رقم السؤال (Question_ID) مطلوب.'); continue; }
    if (code.length > QUIZ_LIMITS.maxCodeLength) { fail(`رقم السؤال أطول من ${QUIZ_LIMITS.maxCodeLength} حرفاً.`); continue; }
    if (seen.has(code.toLowerCase())) { fail(`رقم السؤال «${code}» مكرر في الملف.`); continue; }
    seen.add(code.toLowerCase());
    if (!body) { fail('نص السؤال مطلوب.'); continue; }
    if (body.length > QUIZ_LIMITS.maxBodyLength) { fail(`نص السؤال أطول من ${QUIZ_LIMITS.maxBodyLength} حرفاً.`); continue; }
    const type = TYPES[norm(typeRaw)];
    if (!type) { fail('نوع السؤال يجب أن يكون MCQ أو Text_Input.'); continue; }

    const diffRaw = get(row, 'Difficulty_Level');
    const difficulty = diffRaw ? LEVELS[norm(diffRaw)] : 'MEDIUM';
    if (!difficulty) { fail('مستوى الصعوبة يجب أن يكون Easy أو Medium أو Hard.'); continue; }

    const dayRaw = get(row, 'Day');
    let day: number | null = null;
    if (dayRaw) {
      day = Number(dayRaw);
      if (!Number.isInteger(day) || day < 1 || day > dayCount) {
        fail(dayCount > 0 ? `اليوم يجب أن يكون بين 1 و${dayCount} أو يُترك فارغاً.` : 'لا توجد أيام في هذه الدورة؛ اترك عمود اليوم فارغاً.');
        continue;
      }
    }

    const answerRaw = get(row, 'Correct_Answer');
    if (type === 'TEXT') {
      if (answerRaw.length > QUIZ_LIMITS.maxBodyLength) { fail('الإجابة النموذجية طويلة جداً.'); continue; }
      questions.push({ code, body, type, options: [], correctAnswer: answerRaw, difficulty, day });
      continue;
    }

    const options = splitOptions(get(row, 'Options_List'));
    if (options.length < QUIZ_LIMITS.options.min || options.length > QUIZ_LIMITS.options.max) {
      fail(`سؤال الاختيار من متعدد يحتاج من ${QUIZ_LIMITS.options.min} إلى ${QUIZ_LIMITS.options.max} خيارات (وجدنا ${options.length}).`);
      continue;
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) { fail('الخيارات يجب ألا تتكرر.'); continue; }
    if (options.some((o) => o.length > QUIZ_LIMITS.maxOptionLength)) { fail(`أحد الخيارات أطول من ${QUIZ_LIMITS.maxOptionLength} حرفاً.`); continue; }
    if (!answerRaw) { fail('الإجابة الصحيحة (Correct_Answer) مطلوبة.'); continue; }

    // The answer is the option's text; a letter (A-F) or position (1-6) is also accepted.
    let correct = options.find((o) => o.toLowerCase() === answerRaw.toLowerCase());
    if (!correct) {
      const letter = /^[A-Fa-f]$/.test(answerRaw) ? answerRaw.toUpperCase().charCodeAt(0) - 65 : /^[1-6]$/.test(answerRaw) ? Number(answerRaw) - 1 : -1;
      correct = options[letter];
    }
    if (!correct) { fail('الإجابة الصحيحة يجب أن تطابق أحد الخيارات (أو حرفه A-F أو رقمه).'); continue; }
    questions.push({ code, body, type, options, correctAnswer: correct, difficulty, day });
  }

  if (questions.length > QUIZ_LIMITS.maxQuestions) {
    errors.push({ row: 0, message: `الحد الأقصى ${QUIZ_LIMITS.maxQuestions} سؤال في الملف.` });
  }
  if (questions.length === 0 && errors.length === 0) errors.push({ row: 0, message: 'لا توجد أسئلة في الملف.' });
  return { questions, errors };
}

const TYPE_LABEL: Record<QuestionType, string> = { MCQ: 'MCQ', TEXT: 'Text_Input' };
const LEVEL_LABEL: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

export interface ExportQuestion extends Omit<ParsedQuestion, 'day'> {
  day: number | null;
}

const SAMPLES: ExportQuestion[] = [
  { code: 'Q_D1_001', body: 'ما الفرق الأساسي بين git commit و git push؟', type: 'MCQ', options: ['commit يحفظ محلياً و push يرفع إلى الخادم', 'commit يرفع إلى الخادم و push يحفظ محلياً', 'لا فرق بينهما', 'كلاهما يحذف الملفات'], correctAnswer: 'commit يحفظ محلياً و push يرفع إلى الخادم', difficulty: 'EASY', day: 1 },
  { code: 'Q_D1_002', body: 'اشرح بكلمات بسيطة فائدة الفروع (branches) في العمل الجماعي.', type: 'TEXT', options: [], correctAnswer: 'تتيح لكل عضو العمل على ميزته دون التأثير على الشيفرة الرئيسية ثم الدمج بعد المراجعة.', difficulty: 'MEDIUM', day: 1 },
  { code: 'Q_ALL_001', body: 'أي الأوامر ينشئ نسخة محلية من مستودع بعيد؟', type: 'MCQ', options: ['git clone', 'git init', 'git add', 'git merge'], correctAnswer: 'git clone', difficulty: 'EASY', day: null },
];

/** Builds the question-bank workbook: the supervisor's questions, or a filled-in template when none. */
export async function buildQuestionWorkbook(questions: ExportQuestion[], template: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 't3leem.my';
  const sheet = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Question_ID', key: 'code', width: 14 },
    { header: 'Question_Text', key: 'body', width: 60 },
    { header: 'Question_Type', key: 'type', width: 16 },
    { header: 'Options_List', key: 'options', width: 60 },
    { header: 'Correct_Answer', key: 'answer', width: 40 },
    { header: 'Difficulty_Level', key: 'level', width: 16 },
    { header: 'Day', key: 'day', width: 8 },
  ];
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E5A4A' } };
  head.alignment = { vertical: 'middle' };

  const rows = template ? SAMPLES : questions;
  for (const q of rows) {
    // Options are joined with " | " so an option may contain a comma.
    sheet.addRow({ code: q.code, body: q.body, type: TYPE_LABEL[q.type], options: q.options.join(' | '), answer: q.correctAnswer, level: LEVEL_LABEL[q.difficulty], day: q.day ?? '' });
  }
  const last = Math.max(rows.length + 1, 200);
  for (let r = 2; r <= last; r++) {
    sheet.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"MCQ,Text_Input"'] };
    sheet.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Easy,Medium,Hard"'] };
    sheet.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' };
    sheet.getCell(`D${r}`).alignment = { wrapText: true, vertical: 'top' };
  }

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    'تعليمات تعبئة بنك الأسئلة',
    '• Question_ID: رقم فريد لكل سؤال (مثل Q_D1_001). عند إعادة الاستيراد يُحدَّث السؤال الذي له الرقم نفسه.',
    '• Question_Text: نص السؤال.',
    '• Question_Type: MCQ (اختيار من متعدد، يُصحَّح آلياً) أو Text_Input (إجابة نصية، تُحفظ للمراجعة ولا تُحتسب في الدرجة).',
    '• Options_List: خيارات MCQ من 2 إلى 6، يفصل بينها الرمز | (أو فاصلة إن لم تحتوِ الخيارات على فواصل).',
    '• Correct_Answer: نص الخيار الصحيح (أو حرفه A-F أو رقمه 1-6). في Text_Input هي الإجابة النموذجية وتظهر للمتدرب بعد التسليم.',
    '• Difficulty_Level: Easy أو Medium أو Hard (الافتراضي Medium).',
    '• Day: رقم اليوم الذي يظهر فيه السؤال. اتركه فارغاً ليدخل في مجموعة الدورة المشتركة (تُستخدم لأي يوم ليس له أسئلة خاصة).',
  ].forEach((line, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
