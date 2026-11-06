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
import { formatNumber, isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../../dashboard/health/health-forms';

export const metadata: Metadata = { title: 'الدبلومات والطلاب والجداول' };

const NOTICES: Record<string, string> = { program: 'تم تحديث البرامج.', instructor: 'تم تحديث المدربين.', student: 'تم تحديث الطلاب.', session: 'تم تحديث الجدول.' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'منتظم', GRADUATED: 'متخرج', SUSPENDED: 'موقوف', WITHDRAWN: 'منسحب' };
const SESSION_LABEL: Record<string, string> = { SCHEDULED: 'مجدولة', HELD: 'نُفِّذت', CANCELLED: 'ملغاة' };
const fmt = (iso: string) => new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** A read the role may not make (403) just hides that section. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null;
    throw err;
  }
}

export default async function AcademicPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute/academic`)}`);
  const t = session.token;

  let me;
  try {
    me = await admin.instituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) redirect(`/${slug}/institute`);
    throw err;
  }
  const from = new Date(Date.now() - 24 * 3_600_000).toISOString();
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

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>الدبلومات والطلاب والجداول</h1>
          <p className="muted">البرامج ومستوياتها ومواد كل مستوى، والمدربون والطلاب، وجدول الحصص. النظام يمنع حجز القاعة أو المدرب في وقتين متداخلين.</p>
        </div>
        <Link href={`/${slug}/institute`} className="btn btn-ghost">الفروع والقاعات والأصول</Link>
      </div>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {sessions && (
        <section className="card stack" aria-labelledby="sess-h">
          <h2 id="sess-h">جدول الحصص (من أمس وخلال ٤٥ يوماً) ({formatNumber(sessions.sessions.length)})</h2>
          {sessions.sessions.length === 0 ? <p className="muted">لا توجد حصص في هذه الفترة.</p> : (
            <table className="table"><thead><tr><th>الوقت</th><th>المادة</th><th>القاعة</th><th>المدرب</th><th>الحالة</th><th /></tr></thead>
              <tbody>{sessions.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{fmt(s.starts_at)} ← {new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', timeStyle: 'short' }).format(new Date(s.ends_at))}</td>
                  <td>{subjectName.get(s.subject_id) ?? '—'}</td><td>{roomName.get(s.room_id) ?? '—'}</td><td>{instrName.get(s.instructor_id) ?? '—'}</td><td>{SESSION_LABEL[s.status]}</td>
                  <td className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {s.status !== 'CANCELLED' && <Link href={`/${slug}/institute/session/${s.id}`} className="btn btn-ghost">الحضور</Link>}
                    {w.session && s.status === 'SCHEDULED' && (
                      <>
                        <ConfirmAction action={setSessionStatusAction.bind(null, slug, s, 'HELD')} label="تمّت" confirmText="تسجيل الحصة كمنفذة؟ لن يمكن نقلها بعد ذلك." variant="ghost" />
                        <ConfirmAction action={setSessionStatusAction.bind(null, slug, s, 'CANCELLED')} label="إلغاء" confirmText="إلغاء هذه الحصة؟" variant="danger" />
                      </>
                    )}
                  </td>
                </tr>
              ))}</tbody></table>
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
