import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addInstructorAction,
  addLevelAction,
  addProgramAction,
  addStudentAction,
  addSubjectAction,
  deleteInstructorAction,
  deleteLevelAction,
  deleteProgramAction,
  deleteStudentAction,
  deleteSubjectAction,
  scheduleSessionAction,
  setSessionStatusAction,
} from '@/lib/institute-actions';
import { ApiError, admin } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
/** Counts use Latin digits in the institute workspace (readable and tabular, like the amounts). */
const formatNumber = (n: number) => n.toLocaleString('ar-SA-u-nu-latn');
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../../dashboard/health/health-forms';
import { getInstituteMe } from '../ix-data';

export const metadata: Metadata = { title: 'الدبلومات والطلاب والجداول' };

const NOTICES: Record<string, string> = { program: 'تم تحديث البرامج.', instructor: 'تم تحديث المدربين.', student: 'تم تحديث الطلاب.', session: 'تم تحديث الجدول.' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'منتظم', GRADUATED: 'متخرج', SUSPENDED: 'موقوف', WITHDRAWN: 'منسحب' };
const SESSION_LABEL: Record<string, string> = { SCHEDULED: 'مجدولة', HELD: 'نُفِّذت', CANCELLED: 'ملغاة' };
const fmt = (iso: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** A read the role may not make (403) just hides that section. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null;
    throw err;
  }
}

export default async function AcademicPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ saved?: string; ss?: string; sp?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute/academic`)}`);
  const t = session.token;

  let me;
  try {
    me = await getInstituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) redirect(`/${slug}/institute`);
    throw err;
  }
  const from = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const to = new Date(Date.now() + 45 * 24 * 3_600_000).toISOString();
  const [branches, rooms, programs, instructors, students, sessions] = await Promise.all([
    orNull(admin.instituteBranches(slug, t)),
    orNull(admin.instituteRooms(slug, t)),
    orNull(admin.institutePrograms(slug, t)),
    orNull(admin.instituteInstructors(slug, t)),
    orNull(admin.instituteStudents(slug, t)),
    orNull(admin.instituteSessions(slug, t, from, to)),
  ]);
  const w = me.can_write;
  const branchList = branches?.branches ?? [];
  const roomList = rooms?.rooms ?? [];
  const programList = programs?.programs ?? [];
  const instrList = instructors?.instructors ?? [];
  const studentList = students?.students ?? [];
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const roomName = new Map(roomList.map((r) => [r.id, r.name]));
  const instrName = new Map(instrList.map((i) => [i.id, i.full_name]));
  const programName = new Map(programList.map((p) => [p.id, p.name]));
  const levelName = new Map(programList.flatMap((p) => p.levels.map((l) => [l.id, l.name] as const)));
  const subjects = programList.flatMap((p) => p.levels.flatMap((l) => l.subjects.map((s) => ({ ...s, label: `${p.name} › ${l.name} › ${s.name}` }))));
  const subjectName = new Map(subjects.map((s) => [s.id, s.label]));
  const showMoney = programList.some((p) => p.fee !== undefined);
  const notice = sp.saved ? NOTICES[sp.saved] : null;
  const only = branchList.length === 1 ? branchList[0]?.id : '';
  const BranchSelect = ({ name }: { name: string }) => (
    <select name={name} required defaultValue={only}>
      <option value="" disabled>اختر الفرع</option>
      {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );

  // Sessions: upcoming ones by default (grouped by day, a page at a time); the past month on its own tab, newest first.
  const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const todayKey = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const allSessions = sessions?.sessions ?? [];
  const upcomingSessions = allSessions.filter((x) => dayKey(x.starts_at) >= todayKey);
  const pastSessions = allSessions.filter((x) => dayKey(x.starts_at) < todayKey).reverse();
  const tab = sp.ss === 'past' ? 'past' : 'next';
  const tabList = tab === 'past' ? pastSessions : upcomingSessions;
  const PAGE = 20;
  const sPages = Math.max(1, Math.ceil(tabList.length / PAGE));
  const sPage = Math.min(sPages, Math.max(1, Number(sp.sp) || 1));
  const pageList = tabList.slice((sPage - 1) * PAGE, sPage * PAGE);
  const dayGroups: { key: string; items: typeof pageList }[] = [];
  for (const x of pageList) {
    const k = dayKey(x.starts_at);
    const g = dayGroups[dayGroups.length - 1];
    if (g && g.key === k) g.items.push(x);
    else dayGroups.push({ key: k, items: [x] });
  }
  const dayTitle = (k: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${k}T12:00:00+03:00`));
  const timeOnly = (iso: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const sLink = (extra: { ss?: string; sp?: number }) => `/${slug}/institute/academic?${new URLSearchParams({ ...(extra.ss ?? tab) === 'past' ? { ss: 'past' } : {}, ...(extra.sp && extra.sp > 1 ? { sp: String(extra.sp) } : {}) }).toString()}#sessions`;
  const CHIP: Record<string, string> = { SCHEDULED: '', HELD: 'ok', CANCELLED: 'mute' };

  return (
    <div className="stack">
      <header className="ix-head">
        <div>
          <h1>الطلاب والجدول</h1>
          <p>البرامج ومستوياتها ومواد كل مستوى، والمدربون والطلاب، وجدول الحصص. النظام يمنع حجز القاعة أو المدرب في وقتين متداخلين.</p>
        </div>
      </header>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {sessions && (
        <section className="card stack" aria-labelledby="sess-h" id="sessions">
          <div className="ix-head">
            <h2 id="sess-h">جدول الحصص</h2>
            <nav className="ix-seg" aria-label="الحصص">
              <Link href={sLink({ ss: 'next' })} aria-current={tab === 'next' ? 'true' : undefined}>القادمة <span className="muted">{formatNumber(upcomingSessions.length)}</span></Link>
              <Link href={sLink({ ss: 'past' })} aria-current={tab === 'past' ? 'true' : undefined}>آخر ٣٠ يوماً <span className="muted">{formatNumber(pastSessions.length)}</span></Link>
            </nav>
          </div>
          {tabList.length === 0 ? <p className="muted">{tab === 'next' ? 'لا توجد حصص قادمة خلال ٤٥ يوماً. جدوِل حصة من الزر أدناه.' : 'لا توجد حصص في آخر ٣٠ يوماً.'}</p> : (
            <div className="ix-days">
              {dayGroups.map((g) => (
                <div key={g.key} className="ix-day">
                  <h3>{dayTitle(g.key)}{g.key === todayKey ? <span className="ix-chip">اليوم</span> : null}<small>{formatNumber(g.items.length)} {g.items.length === 1 ? 'حصة' : 'حصص'}</small></h3>
                  <ul>
                    {g.items.map((x) => (
                      <li key={x.id} className={x.status === 'CANCELLED' ? 'gone' : undefined}>
                        <span className="ix-sess-time" dir="ltr">{timeOnly(x.starts_at)} – {timeOnly(x.ends_at)}</span>
                        <span className="ix-sess-main"><b>{subjectName.get(x.subject_id) ?? '—'}</b><small>{roomName.get(x.room_id) ?? '—'} · {instrName.get(x.instructor_id) ?? '—'}</small></span>
                        <span className={`ix-chip ${CHIP[x.status]}`}>{SESSION_LABEL[x.status]}</span>
                        <span className="ix-sess-actions">
                          {x.status !== 'CANCELLED' && <Link href={`/${slug}/institute/session/${x.id}`} className="btn btn-ghost">الحضور</Link>}
                          {w.session && x.status === 'SCHEDULED' && (
                            <details className="ix-more">
                              <summary aria-label="المزيد">المزيد</summary>
                              <div>
                                <ConfirmAction action={setSessionStatusAction.bind(null, slug, x, 'HELD')} label="تسجيل كمنفذة" confirmText="تسجيل الحصة كمنفذة؟ لن يمكن نقلها بعد ذلك." variant="ghost" />
                                <ConfirmAction action={setSessionStatusAction.bind(null, slug, x, 'CANCELLED')} label="إلغاء الحصة" confirmText="إلغاء هذه الحصة؟" variant="danger" />
                              </div>
                            </details>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {sPages > 1 && (
            <nav className="ix-pager" aria-label="صفحات الحصص">
              {sPage > 1 && <Link href={sLink({ sp: sPage - 1 })} className="btn btn-ghost">السابقة</Link>}
              <span className="small muted">صفحة {formatNumber(sPage)} من {formatNumber(sPages)}</span>
              {sPage < sPages && <Link href={sLink({ sp: sPage + 1 })} className="btn btn-ghost">التالية</Link>}
            </nav>
          )}
          {w.session && subjects.length > 0 && (
            <details>
              <summary>جدولة حصة</summary>
              <ActionForm action={scheduleSessionAction.bind(null, slug)} submitLabel="جدولة">
                <label>المادة<select name="subject_id" required defaultValue=""><option value="" disabled>اختر المادة</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                <label>القاعة <span className="hint">(من فرع المادة)</span><select name="room_id" required defaultValue=""><option value="" disabled>اختر القاعة</option>{roomList.map((r) => <option key={r.id} value={r.id}>{branchName.get(r.branch_id)} — {r.name} ({r.capacity})</option>)}</select></label>
                <label>المدرب<select name="instructor_id" required defaultValue=""><option value="" disabled>اختر المدرب</option>{instrList.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{branchName.get(i.branch_id)} — {i.full_name}</option>)}</select></label>
                <label>التاريخ<input type="date" name="date" required /></label>
                <label>من (بتوقيت السعودية)<input type="time" name="from" required /></label>
                <label>إلى<input type="time" name="to" required /></label>
                <label>ملاحظات<input name="notes" maxLength={500} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {programs && (
        <section className="card stack" aria-labelledby="prog-h">
          <h2 id="prog-h">الدبلومات والبرامج ({formatNumber(programList.length)})</h2>
          {programList.length === 0 && <p className="muted">لا توجد برامج بعد.</p>}
          {programList.map((p) => (
            <div key={p.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line, #d6e3f0)', paddingTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <strong>{p.name} <span className="muted">· {branchName.get(p.branch_id) ?? ''}{p.fee !== undefined ? ` · ${p.fee} ريال` : ''}{!p.active ? ' · غير مفعّل' : ''}</span></strong>
                {w.program && <ConfirmAction action={deleteProgramAction.bind(null, slug, p.id)} label="حذف البرنامج" confirmText={`حذف ${p.name}؟`} variant="danger" />}
              </div>
              {p.admission_requirements && <p className="small muted">شروط القبول: {p.admission_requirements}</p>}
              {p.levels.map((l) => (
                <div key={l.id} className="stack" style={{ gap: 4, paddingInlineStart: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span>{l.sort_order}. {l.name}</span>
                    {w.program && <ConfirmAction action={deleteLevelAction.bind(null, slug, l.id)} label="حذف المستوى" confirmText={`حذف ${l.name} ومواده؟`} variant="ghost" />}
                  </div>
                  <ul className="small" style={{ paddingInlineStart: 18 }}>
                    {l.subjects.map((s) => (
                      <li key={s.id}>{s.name} — {s.hours} ساعة{s.fee ? ` — ${s.fee} ريال` : ''}
                        {w.program && <ConfirmAction action={deleteSubjectAction.bind(null, slug, s.id)} label="حذف" confirmText={`حذف المادة ${s.name}؟`} variant="ghost" />}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
          {w.program && (
            <>
              <details>
                <summary>إضافة برنامج</summary>
                <ActionForm action={addProgramAction.bind(null, slug)} submitLabel="إضافة البرنامج">
                  <label>الفرع<BranchSelect name="branch_id" /></label>
                  <label>اسم البرنامج<input name="name" required maxLength={120} /></label>
                  <label>شروط القبول<input name="admission_requirements" maxLength={1000} /></label>
                  <label className="check"><input type="checkbox" name="state_borne_vat" /> رسوم البرنامج مشمولة بتحمّل الدولة ضريبة القيمة المضافة عن المواطنين (التعليم الأهلي المشمول بالأمر الملكي أ/86: مدارس وجامعات أهلية وبرامج المؤسسة العامة للتدريب التقني والمهني المعادلة). تأكد من ترخيص البرنامج.</label>
                  {showMoney && <label>الرسوم (ريال)<input name="fee" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>}
                </ActionForm>
              </details>
              {programList.length > 0 && (
                <>
                  <details>
                    <summary>إضافة مستوى</summary>
                    <ActionForm action={addLevelAction.bind(null, slug)} submitLabel="إضافة المستوى">
                      <label>البرنامج<select name="program_id" required defaultValue=""><option value="" disabled>اختر البرنامج</option>{programList.map((p) => <option key={p.id} value={p.id}>{branchName.get(p.branch_id)} — {p.name}</option>)}</select></label>
                      <label>اسم المستوى<input name="name" required maxLength={80} /></label>
                      <label>الترتيب<input type="number" name="sort_order" min={1} max={100} required defaultValue={1} /></label>
                    </ActionForm>
                  </details>
                  <details>
                    <summary>إضافة مادة</summary>
                    <ActionForm action={addSubjectAction.bind(null, slug)} submitLabel="إضافة المادة">
                      <label>المستوى<select name="level_id" required defaultValue=""><option value="" disabled>اختر المستوى</option>{programList.flatMap((p) => p.levels.map((l) => <option key={l.id} value={l.id}>{p.name} › {l.name}</option>))}</select></label>
                      <label>اسم المادة<input name="name" required maxLength={120} /></label>
                      <label>عدد الساعات<input type="number" name="hours" min={1} max={2000} required /></label>
                      {showMoney && <label>الرسوم (ريال، اختياري)<input name="fee" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>}
                    </ActionForm>
                  </details>
                </>
              )}
            </>
          )}
        </section>
      )}

      {instructors && (
        <section className="card stack" aria-labelledby="instr-h">
          <h2 id="instr-h">المدربون ({formatNumber(instrList.length)})</h2>
          {instrList.length === 0 ? <p className="muted">لا يوجد مدربون.</p> : (
            <table className="table"><thead><tr><th>الاسم</th><th>الفرع</th><th>المؤهلات</th>{showMoney && <th>أجر الساعة</th>}{w.instructor && <th />}</tr></thead>
              <tbody>{instrList.map((i) => (
                <tr key={i.id}><td>{i.full_name}{!i.active ? <span className="muted"> (غير نشط)</span> : null}</td><td>{branchName.get(i.branch_id) ?? '—'}</td><td>{i.qualifications ?? '—'}</td>{showMoney && <td>{i.hourly_rate ?? '—'}</td>}
                  {w.instructor && <td><ConfirmAction action={deleteInstructorAction.bind(null, slug, i.id)} label="حذف" confirmText={`حذف ${i.full_name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.instructor && (
            <details>
              <summary>إضافة مدرب</summary>
              <ActionForm action={addInstructorAction.bind(null, slug)} submitLabel="إضافة المدرب">
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>الاسم الكامل<input name="full_name" required maxLength={120} /></label>
                <label>المؤهلات<input name="qualifications" maxLength={500} /></label>
                <label>الجوال<input name="phone" maxLength={30} dir="ltr" inputMode="tel" /></label>
                <label>البريد<input type="email" name="email" dir="ltr" /></label>
                {showMoney && <label>أجر الساعة (ريال)<input name="hourly_rate" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>}
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {students && (
        <section className="card stack" aria-labelledby="stud-h">
          <h2 id="stud-h">الطلاب ({formatNumber(studentList.length)})</h2>
          {studentList.length === 0 ? <p className="muted">لا يوجد طلاب.</p> : (
            <table className="table"><thead><tr><th>الاسم</th><th>الفرع</th><th>البرنامج / المستوى</th><th>الحالة</th>{w.student && <th />}</tr></thead>
              <tbody>{studentList.map((s) => (
                <tr key={s.id}><td>{s.full_name}</td><td>{branchName.get(s.branch_id) ?? '—'}</td><td>{s.program_id ? `${programName.get(s.program_id) ?? ''}${s.level_id ? ` › ${levelName.get(s.level_id) ?? ''}` : ''}` : '—'}</td><td>{STATUS_LABEL[s.status]}{s.citizenship === 'SAUDI' ? ` · مواطن${s.has_national_id ? ` (هوية ••••${s.national_id_last4 ?? ''})` : ' (بلا هوية)'}` : ''}</td>
                  {w.student && <td><ConfirmAction action={deleteStudentAction.bind(null, slug, s.id)} label="حذف" confirmText={`حذف ${s.full_name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.student && (
            <details>
              <summary>تسجيل طالب</summary>
              <ActionForm action={addStudentAction.bind(null, slug)} submitLabel="تسجيل الطالب">
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>الاسم الكامل<input name="full_name" required maxLength={120} /></label>
                <label>البرنامج والمستوى <span className="hint">(يجب أن يكون من فرع الطالب)</span>
                  <select name="track" defaultValue=""><option value="">بلا برنامج بعد</option>{programList.flatMap((p) => [<option key={p.id} value={`${p.id}|`}>{branchName.get(p.branch_id)} — {p.name}</option>, ...p.levels.map((l) => <option key={l.id} value={`${p.id}|${l.id}`}>{branchName.get(p.branch_id)} — {p.name} › {l.name}</option>)])}</select></label>
                <label>تاريخ الالتحاق<input type="date" name="enrolled_on" /></label>
                <label>الجنسية<select name="citizenship" defaultValue="OTHER"><option value="OTHER">غير سعودي (مقيم): الضريبة 15٪</option><option value="SAUDI">سعودي: تتحمل الدولة الضريبة في البرنامج المشمول</option></select></label>
                <label>رقم الهوية الوطنية أو الإقامة <span className="hint">(١٠ أرقام؛ يلزم للمواطن في فاتورة تتحمل الدولة ضريبتها. يُحفظ مشفراً ولا يُعرض)</span><input name="national_id" inputMode="numeric" pattern="\d{10}" maxLength={10} dir="ltr" autoComplete="off" /></label>
                <label>الجوال<input name="phone" maxLength={30} dir="ltr" inputMode="tel" /></label>
                <label>البريد<input type="email" name="email" dir="ltr" /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
