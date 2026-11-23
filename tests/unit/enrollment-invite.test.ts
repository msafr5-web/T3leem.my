import type { MailMessage, Mailer } from '../../src/shared/services/mailer';
import { invitationMessage, type InvitationCourse } from '../../src/modules/provider/enrollment-invite';
import type { ProviderRepository } from '../../src/modules/provider/provider.repository';
import { ProviderService } from '../../src/modules/provider/provider.service';
import type { Actor, CourseRosterRow } from '../../src/modules/provider/provider.types';

const T = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const actor: Actor = { userId: 'admin', role: 'TENANT_ADMIN', ip: '127.0.0.1' };
const academy = { name: 'Hila Co', slug: 'hila' };
const webUrl = 'https://t3leem.my/';
const recorded: InvitationCourse = { title: 'إدارة المشاريع', startsAt: new Date('2027-01-10T16:00:00Z'), days: 5, nextSession: null };

describe('invitationMessage', () => {
  const base = { name: 'محمد العتيبي', academy, webUrl, accountCreated: false };

  it('names the course and academy, gives the login link, and explains the e-mailed code and the attendance check-in', () => {
    const m = invitationMessage({ ...base, course: recorded });
    expect(m.subject).toBe('دعوة للتدريب: «إدارة المشاريع» — Hila Co');
    expect(m.text).toContain('مرحباً محمد العتيبي');
    expect(m.text).toContain('سُجّلت في دورة «إدارة المشاريع» في «Hila Co»');
    expect(m.text).toContain('https://t3leem.my/hila/login'); // no double slash
    expect(m.text).toContain('رمز من ٦ أرقام');
    expect(m.text).toContain('سجّل حضورك');
    expect(m.text).toContain('١٠٪');
    expect(m.text).not.toMatch(/\d{6}/); // no code in an invitation
  });

  it('a recorded course says when it starts and how many days it runs (Saudi time)', () => {
    const m = invitationMessage({ ...base, course: recorded });
    expect(m.text).toContain('تبدأ الدورة');
    expect(m.text).toContain('وتمتد 5 أيام');
    expect(invitationMessage({ ...base, course: { ...recorded, days: 1 } }).text).toContain('وتمتد 1 يوماً');
  });

  it('a live course gives its next session; with neither it says the dates will follow', () => {
    const live: InvitationCourse = { title: 'دورة مباشرة', startsAt: null, days: 0, nextSession: { title: 'الجلسة الأولى', startsAt: new Date('2027-02-01T15:00:00Z') } };
    expect(invitationMessage({ ...base, course: live }).text).toContain('أول جلسة مباشرة: «الجلسة الأولى»');
    expect(invitationMessage({ ...base, course: { ...live, nextSession: null } }).text).toContain('سيُعلَن موعد الجلسات قريباً');
  });

  it('mentions the new account only when one was created', () => {
    expect(invitationMessage({ ...base, course: recorded, accountCreated: true }).text).toContain('أُنشئ لك حساب');
    expect(invitationMessage({ ...base, course: recorded }).text).not.toContain('أُنشئ لك حساب');
  });

  it('escapes anything typed by people in the HTML part', () => {
    const m = invitationMessage({ ...base, name: '<img src=x onerror=1>', course: { ...recorded, title: 'A & "B"' }, academy: { name: '<b>Co</b>', slug: 'hila' } });
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('<b>Co</b>');
    expect(m.html).toContain('&lt;img src=x onerror=1&gt;');
    expect(m.html).toContain('A &amp; &quot;B&quot;');
  });
});

class Capture implements Mailer {
  sent: MailMessage[] = [];
  failFor = new Set<string>();
  active = 0;
  peak = 0;
  async send(m: MailMessage) {
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    await new Promise((r) => setTimeout(r, 5));
    this.active--;
    if (this.failFor.has(m.to)) throw new Error('smtp down');
    this.sent.push(m);
  }
}

function setup(opts: { withMailer?: boolean; roster?: Partial<CourseRosterRow>[]; info?: InvitationCourse | null } = {}) {
  const mailer = new Capture();
  const result = (email: string, status: 'enrolled' | 'already_enrolled' | 'error', created = false) => ({ email, fullName: email.split('@')[0] as string, status, accountCreated: created });
  const repo = {
    countOwned: jest.fn(async (_t: string, ids: { courseIds?: string[] }) => ({ courses: (ids.courseIds ?? []).length, trainers: 0 })),
    enrollTrainees: jest.fn(async (_t: string, _a: Actor, _c: string, drafts: { email: string }[]) => drafts.map((d) => result(d.email, d.email.startsWith('old') ? 'already_enrolled' : d.email.startsWith('bad') ? 'error' : 'enrolled', d.email.startsWith('new'))),
    ),
    courseInvitationInfo: jest.fn(async () => (opts.info === undefined ? recorded : opts.info)),
    listCourseRoster: jest.fn(async () =>
      (opts.roster ?? []).map((r, i) => ({ enrollmentId: `e${i}`, userId: `u${i}`, fullName: null, email: `r${i}@x.test`, phone: null, employeeNo: null, progressPercentage: 0, completionStatus: 'ENROLLED', status: 'ACTIVE', source: 'ADMIN', enrolledAt: new Date(), ...r })),
    ),
  } as unknown as jest.Mocked<ProviderRepository>;
  const service = new ProviderService({ repository: repo, hashPassword: async (p) => `h(${p.length})`, ...(opts.withMailer === false ? {} : { mailer, webUrl }) });
  const people = (...emails: string[]) => emails.map((e) => ({ fullName: `Person ${e.split('@')[0]}`, email: e }));
  return { service, repo, mailer, people };
}

describe('invitations on enrollment', () => {
  it('e-mails only the NEWLY enrolled (not those already in the course, not rows that failed), saying when an account was created', async () => {
    const { service, mailer, people } = setup();
    const r = await service.enrollTraineesInvited(T, actor, academy, 'c1', people('new1@x.test', 'old1@x.test', 'bad1@x.test', 'new2@x.test'), true);
    expect(r.invitations).toBe(2);
    await service.drainInvitations();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['new1@x.test', 'new2@x.test']);
    expect(mailer.sent[0]?.text).toContain('أُنشئ لك حساب'); // 'new…' addresses are reported as new accounts by the double
  });

  it('sends nothing when the admin switched invitations off, when there is no mailer, or when nobody is new', async () => {
    const off = setup();
    expect((await off.service.enrollTraineesInvited(T, actor, academy, 'c1', off.people('new1@x.test'), false)).invitations).toBe(0);
    await off.service.drainInvitations();
    expect(off.mailer.sent).toHaveLength(0);

    const none = setup({ withMailer: false });
    expect((await none.service.enrollTraineesInvited(T, actor, academy, 'c1', none.people('new1@x.test'), true)).invitations).toBe(0);

    const nobody = setup();
    expect((await nobody.service.enrollTraineesInvited(T, actor, academy, 'c1', nobody.people('old1@x.test'), true)).invitations).toBe(0);
    expect(nobody.repo.courseInvitationInfo).not.toHaveBeenCalled();
  });

  it('a failed e-mail does not undo or fail the enrollment, and the others are still sent', async () => {
    const { service, mailer, people } = setup();
    mailer.failFor.add('new2@x.test');
    const r = await service.enrollTraineesInvited(T, actor, academy, 'c1', people('new1@x.test', 'new2@x.test', 'new3@x.test'), true);
    expect(r.results.map((x) => x.status)).toEqual(['enrolled', 'enrolled', 'enrolled']);
    await service.drainInvitations();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['new1@x.test', 'new3@x.test']);
  });

  it('sends a few at a time (never more than 5 in flight), so hundreds of employees do not flood the mail server', async () => {
    const { service, mailer, people } = setup();
    const emails = Array.from({ length: 23 }, (_, i) => `new${i}@x.test`);
    await service.enrollTraineesInvited(T, actor, academy, 'c1', people(...emails), true);
    await service.drainInvitations();
    expect(mailer.sent).toHaveLength(23);
    expect(mailer.peak).toBeLessThanOrEqual(5);
    expect(mailer.peak).toBeGreaterThan(1);
  });

  it('an invalid list is refused before anything is sent', async () => {
    const { service, mailer, repo } = setup();
    await expect(service.enrollTraineesInvited(T, actor, academy, 'c1', [{ fullName: 'Ab', email: 'nope' }], true)).rejects.toMatchObject({ code: 'INVALID_TRAINEES' });
    expect(repo.enrollTrainees).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  it('re-sending goes to the employees the admin enrolled who are still active and have not finished', async () => {
    const { service, mailer } = setup({
      roster: [{}, { source: 'SELF' }, { status: 'SUSPENDED' }, { completionStatus: 'COMPLETED' }, { fullName: 'Named Person' }],
    });
    expect(await service.resendInvitations(T, academy, 'c1')).toBe(2);
    await service.drainInvitations();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['r0@x.test', 'r4@x.test']);
    expect(mailer.sent.find((m) => m.to === 'r4@x.test')?.text).toContain('مرحباً Named Person');
    expect(mailer.sent.find((m) => m.to === 'r0@x.test')?.text).toContain('مرحباً r0@x.test'); // no name on file: the address
  });

  it('a missing course sends nothing', async () => {
    const { service, mailer, people } = setup({ info: null });
    expect((await service.enrollTraineesInvited(T, actor, academy, 'c1', people('new1@x.test'), true)).invitations).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});
