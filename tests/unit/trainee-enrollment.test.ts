import type { ProviderRepository } from '../../src/modules/provider/provider.repository';
import { ProviderService } from '../../src/modules/provider/provider.service';
import type { Actor } from '../../src/modules/provider/provider.types';
import { buildTraineeTemplate, cleanTrainee, dedupeBatch, normalizePhone, parseTraineeSheet } from '../../src/modules/provider/trainee.excel';

const T = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const actor: Actor = { userId: 'admin', role: 'TENANT_ADMIN', ip: '127.0.0.1' };

describe('normalizePhone', () => {
  it.each([
    ['0551234567', '+966551234567'],
    ['551234567', '+966551234567'], // Excel drops the leading zero of a numeric cell
    ['966551234567', '+966551234567'],
    ['00966551234567', '+966551234567'],
    ['+966 55 123 4567', '+966551234567'],
    ['055-123-4567', '+966551234567'],
    ['٠٥٥١٢٣٤٥٦٧', '+966551234567'], // Arabic-Indic digits
    ['+971501234567', '+971501234567'], // other countries stay as given
  ])('%s -> %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each(['12345', 'abc', '+0123456789', '05512'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeNull());
});

describe('cleanTrainee', () => {
  it('trims, lowercases the e-mail and normalizes the phone', () => {
    expect(cleanTrainee({ fullName: '  محمد   العتيبي ', email: ' Mo@Corp.Example ', phone: '0551234567', employeeNo: ' E-1 ' })).toEqual({
      fullName: 'محمد العتيبي',
      email: 'mo@corp.example',
      phone: '+966551234567',
      employeeNo: 'E-1',
    });
  });

  it('treats empty phone and staff number as null', () => {
    expect(cleanTrainee({ fullName: 'Sara Ali', email: 'sara@corp.example', phone: '', employeeNo: '  ' })).toMatchObject({ phone: null, employeeNo: null });
  });

  it.each([
    [{ fullName: 'ab', email: 'a@b.co' }, 'الاسم'],
    [{ fullName: 'Valid Name', email: 'not-an-email' }, 'البريد'],
    [{ fullName: 'Valid Name', email: 'a@b.co', phone: '123' }, 'الجوال'],
    [{ fullName: 'Valid Name', email: 'a@b.co', employeeNo: 'x'.repeat(41) }, 'الرقم الوظيفي'],
  ])('rejects %j', (input, word) => {
    const r = cleanTrainee(input);
    expect(typeof r).toBe('string');
    expect(r as string).toContain(word);
  });
});

describe('dedupeBatch', () => {
  const d = (email: string, phone: string | null = null, employeeNo: string | null = null) => ({ fullName: 'Some Name', email, phone, employeeNo });

  it('keeps the first occurrence and reports later e-mail, phone and staff-number repeats on their own row', () => {
    const { trainees, errors } = dedupeBatch([
      { row: 2, draft: d('a@x.co', '+966551111111', 'E1') },
      { row: 3, draft: d('a@x.co') },
      { row: 4, draft: d('b@x.co', '+966551111111') },
      { row: 5, draft: d('c@x.co', null, 'E1') },
      { row: 6, draft: d('d@x.co') },
    ]);
    expect(trainees.map((t) => t.email)).toEqual(['a@x.co', 'd@x.co']);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(errors[0]?.message).toContain('الصف 2');
  });
});

describe('parseTraineeSheet', () => {
  const csv = (text: string) => Buffer.from(text, 'utf8');

  it('reads English and Arabic headers and normalizes rows', async () => {
    const r = await parseTraineeSheet(csv('الاسم,البريد الإلكتروني,رقم الجوال,الرقم الوظيفي\nمحمد العتيبي,m@corp.example,0551234567,E-10\n'));
    expect(r.errors).toEqual([]);
    expect(r.trainees).toEqual([{ fullName: 'محمد العتيبي', email: 'm@corp.example', phone: '+966551234567', employeeNo: 'E-10' }]);
  });

  it('collects every row error with its row number and skips blank lines', async () => {
    const r = await parseTraineeSheet(csv('Full_Name,Email,Phone\nAli Hassan,ali@corp.example,\n,,\nBad,bad,\nSara Ahmed,sara@corp.example,999\n'));
    expect(r.trainees).toHaveLength(1);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
  });

  it('asks for the template when required columns are missing', async () => {
    const r = await parseTraineeSheet(csv('Name,Phone\nAli,0551234567\n'));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toContain('Email');
  });

  it('rejects an empty file and a sheet with only headers', async () => {
    expect((await parseTraineeSheet(Buffer.alloc(0))).errors[0]?.row).toBe(0);
    expect((await parseTraineeSheet(csv('Full_Name,Email\n'))).errors).toHaveLength(1);
  });

  it('flags duplicates inside the file', async () => {
    const r = await parseTraineeSheet(csv('Full_Name,Email\nAli Hassan,a@x.co\nAli Again,a@x.co\n'));
    expect(r.trainees).toHaveLength(1);
    expect(r.errors).toEqual([{ row: 3, message: expect.stringContaining('مكرر') }]);
  });

  it('round-trips the downloadable template (its example row is valid)', async () => {
    const r = await parseTraineeSheet(await buildTraineeTemplate());
    expect(r.errors).toEqual([]);
    expect(r.trainees).toEqual([{ fullName: 'محمد أحمد العتيبي', email: 'mohammed@company.example', phone: '+966551234567', employeeNo: 'E-10025' }]);
  });
});

function setup(ownedCourses = ['c1']) {
  const repo = {
    countOwned: jest.fn(async (_t: string, ids: { courseIds?: string[] }) => ({
      courses: (ids.courseIds ?? []).filter((id) => ownedCourses.includes(id)).length,
      trainers: 0,
    })),
    enrollTrainees: jest.fn(async (_t: string, _a: Actor, _c: string, drafts: { email: string; fullName: string }[]) =>
      drafts.map((d) => ({ email: d.email, fullName: d.fullName, status: 'enrolled' as const, accountCreated: true })),
    ),
    listCourseRoster: jest.fn(async () => []),
  } as unknown as jest.Mocked<ProviderRepository>;
  const hashPassword = jest.fn(async (p: string) => `hash(${p.length})`);
  return { service: new ProviderService({ repository: repo, hashPassword }), repo, hashPassword };
}

const person = (email: string, extra: Record<string, string | null> = {}) => ({ fullName: 'Valid Name', email, ...extra });

describe('ProviderService trainee enrollment', () => {
  it('cleans the input, hashes one unusable password for the batch and delegates to the repository', async () => {
    const { service, repo, hashPassword } = setup();
    const out = await service.enrollTrainees(T, actor, 'c1', [person('A@X.co', { phone: '0551234567' }), person('b@x.co')]);
    expect(out).toHaveLength(2);
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword.mock.calls[0]?.[0]).toHaveLength(64); // 32 random bytes as hex, never a guessable value
    const [, , courseId, drafts, hash] = repo.enrollTrainees.mock.calls[0] ?? [];
    expect(courseId).toBe('c1');
    expect(drafts).toEqual([
      { fullName: 'Valid Name', email: 'a@x.co', phone: '+966551234567', employeeNo: null },
      { fullName: 'Valid Name', email: 'b@x.co', phone: null, employeeNo: null },
    ]);
    expect(hash).toBe('hash(64)');
  });

  it('writes nothing when any employee is invalid, and reports every bad row', async () => {
    const { service, repo } = setup();
    await expect(service.enrollTrainees(T, actor, 'c1', [person('ok@x.co'), person('bad'), person('ok@x.co')])).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_TRAINEES',
      details: { errors: [{ row: 2 }, { row: 3 }] },
    });
    expect(repo.enrollTrainees).not.toHaveBeenCalled();
  });

  it('refuses a course that is not in this academy (another academy\'s id)', async () => {
    const { service, repo } = setup(['c1']);
    await expect(service.enrollTrainees(T, actor, 'other-academy-course', [person('a@x.co')])).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
    expect(repo.enrollTrainees).not.toHaveBeenCalled();
  });

  it('rejects an empty list and more than 500 employees', async () => {
    const { service } = setup();
    await expect(service.enrollTrainees(T, actor, 'c1', [])).rejects.toMatchObject({ code: 'NO_TRAINEES' });
    const many = Array.from({ length: 501 }, (_, i) => person(`u${i}@x.co`));
    await expect(service.enrollTrainees(T, actor, 'c1', many)).rejects.toMatchObject({ code: 'TOO_MANY_TRAINEES' });
  });

  it('imports a CSV, and rejects it whole when a row is wrong', async () => {
    const { service, repo } = setup();
    const good = Buffer.from('Full_Name,Email\nAli Hassan,ali@x.co\nSara Ahmed,sara@x.co\n');
    expect(await service.importTrainees(T, actor, 'c1', good)).toHaveLength(2);
    const bad = Buffer.from('Full_Name,Email\nAli Hassan,ali@x.co\nSara Ahmed,nope\n');
    await expect(service.importTrainees(T, actor, 'c1', bad)).rejects.toMatchObject({ code: 'INVALID_TRAINEE_SHEET', details: { errors: [{ row: 3 }] } });
    expect(repo.enrollTrainees).toHaveBeenCalledTimes(1);
  });

  it('checks course ownership before listing a roster', async () => {
    const { service, repo } = setup(['c1']);
    await service.courseRoster(T, 'c1');
    expect(repo.listCourseRoster).toHaveBeenCalledWith(T, 'c1');
    await expect(service.courseRoster(T, 'nope')).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
  });
});
