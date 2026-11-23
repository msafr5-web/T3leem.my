/** The e-mail a trainee gets when the academy's admin enrolls them in a course. */
export interface InvitationCourse {
  title: string;
  /** Day 1 of a recorded course (null for other courses, or when no date was set). */
  startsAt: Date | null;
  /** Number of days of a recorded course (0 when it has none). */
  days: number;
  /** The next scheduled live session of the course, if any. */
  nextSession: { title: string; startsAt: Date } | null;
}

export interface InvitationInput {
  name: string;
  academy: { name: string; slug: string };
  /** Public site address (no trailing slash needed). */
  webUrl: string;
  course: InvitationCourse;
  /** A new account was created for this e-mail address by this enrollment. */
  accountCreated: boolean;
}

const when = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** What the trainee needs to know: which course, when it starts, how to enter, and that attendance is checked with a code. */
export function invitationMessage(i: InvitationInput): { subject: string; text: string; html: string } {
  const login = `${i.webUrl.replace(/\/$/, '')}/${i.academy.slug}/login`;
  const whenLine = i.course.startsAt
    ? `تبدأ الدورة ${when.format(i.course.startsAt)}${i.course.days > 0 ? ` وتمتد ${i.course.days} ${i.course.days === 1 ? 'يوماً' : 'أيام'}` : ''}.`
    : i.course.nextSession
      ? `أول جلسة مباشرة: «${i.course.nextSession.title}» ${when.format(i.course.nextSession.startsAt)}.`
      : 'سيُعلَن موعد الجلسات قريباً.';
  const account = i.accountCreated ? 'أُنشئ لك حساب على هذا البريد الإلكتروني.' : '';
  const enter = 'للدخول افتح الرابط واكتب بريدك الإلكتروني هذا، فيصلك رمز من ٦ أرقام تكتبه ثم تدخل (لا حاجة لكلمة مرور).';
  const attendance = 'في كل جلسة سجّل حضورك من صفحة «دوراتي» برمز يصل إلى بريدك؛ يُفتح التسجيل قبل الجلسة بـ١٥ دقيقة. يُحتسب تأخراً من يسجّل بعد مضي ١٠٪ من مدة الجلسة، ويلزم البقاء حتى نهايتها.';
  const lines = [`مرحباً ${i.name}،`, '', `سُجّلت في دورة «${i.course.title}» في «${i.academy.name}».`, whenLine, ...(account ? [account] : []), '', enter, login, '', attendance];
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1b1f1e;max-width:560px"><p>مرحباً ${escapeHtml(i.name)}،</p><p>سُجّلت في دورة <strong>«${escapeHtml(i.course.title)}»</strong> في «${escapeHtml(i.academy.name)}».</p><p>${escapeHtml(whenLine)}</p>${account ? `<p>${escapeHtml(account)}</p>` : ''}<p>${escapeHtml(enter)}</p><p><a href="${escapeHtml(login)}">${escapeHtml(login)}</a></p><p style="color:#555">${escapeHtml(attendance)}</p></div>`;
  return { subject: `دعوة للتدريب: «${i.course.title}» — ${i.academy.name}`, text: lines.join('\n'), html };
}
