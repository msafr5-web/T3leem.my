import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AttendanceReport, type AttendanceStatus } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { adjustAttendanceAction, revertAttendanceAction, saveAttendanceSettingsAction } from '@/lib/admin-actions';
import { formatDateTime, formatNumber } from '@/lib/format';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<AttendanceStatus, [string, string]> = { PRESENT: ['حاضر', 'badge ok'], LATE: ['متأخر', 'badge draft'], ABSENT: ['غائب', 'badge bad'], PENDING: ['—', 'badge'] };

/** One course: a row per trainee, a column per session, then attendance percentage and whether they pass (85%). */
const SAVED: Record<string, string> = {
  settings: 'حُفظت إعدادات الحضور وأُعيد احتساب النتائج وفقها.',
  adjusted: 'حُفظ قرارك اليدوي.',
  reverted: 'أُلغي القرار اليدوي وعاد الاحتساب التلقائي.',
};

export default async function AttendanceCourse({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ tenant: slug, id }, { saved }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const token = await requireAdmin(slug);
  let report: AttendanceReport;
  try {
    report = await admin.attendanceReport(slug, token, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const held = report.sessions.filter((s) => s.held).length;
  const started = report.sessions.filter((s) => new Date(s.starts_at) <= new Date());
  const adjustments = report.trainees.flatMap((t) => Object.entries(t.adjusted).map(([ref, note]) => ({ trainee: t, session: report.sessions.find((s) => s.ref === ref), note })));
  const limits = report.limits;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>{report.course.title}</h1>
          <p className="muted small">
            {formatNumber(report.sessions.length)} جلسة · {formatNumber(held)} منعقدة · {formatNumber(report.trainees.length)} متدرب · {formatNumber(report.passing_trainees)} يجتازون ({report.rules.pass_percent}٪ فأكثر)
          </p>
        </div>
        <div className="cta-row">
          <a href={`/${slug}/dashboard/attendance/${id}/export`} className="btn btn-primary">
            تنزيل Excel
          </a>
          <Link href={`/${slug}/dashboard/attendance`} className="btn btn-ghost">
            رجوع
          </Link>
        </div>
      </div>

      {saved && SAVED[saved] && (
        <p className="notice ok" role="status">
          {SAVED[saved]}
        </p>
      )}

      <div className="table-wrap">
        {report.trainees.length === 0 ? (
          <p className="empty">لا متدربين مسجلين في هذه الدورة.</p>
        ) : (
          <table className="att-matrix">
            <thead>
              <tr>
                <th>المتدرب</th>
                {report.sessions.map((s) => (
                  <th key={s.ref} scope="col">
                    {s.title}
                    <div className="small muted">{formatDateTime(s.starts_at)}</div>
                  </th>
                ))}
                <th className="num">النسبة</th>
                <th>النتيجة</th>
              </tr>
            </thead>
            <tbody>
              {report.trainees.map((t) => (
                <tr key={t.user_id}>
                  <td>
                    {t.name}
                    {!t.admin_enrolled && <div className="small muted">سجّل بنفسه</div>}
                  </td>
                  {report.sessions.map((s) => {
                    const [label, cls] = STATUS[t.statuses[s.ref] ?? 'PENDING'];
                    const note = t.adjusted[s.ref];
                    return (
                      <td key={s.ref}>
                        <span className={cls} title={note !== undefined ? `قرار يدوي: ${note}` : undefined}>
                          {note !== undefined && '✎ '}
                          {label}
                        </span>
                      </td>
                    );
                  })}
                  <td className="num">{t.summary.percent === null ? '—' : `${formatNumber(t.summary.percent)}٪`}</td>
                  <td>{t.summary.passes === null ? '—' : t.summary.passes ? <span className="badge ok">يجتاز</span> : <span className="badge bad">لا يجتاز</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <section className="card stack" aria-labelledby="rules-heading">
        <h2 id="rules-heading" style={{ fontSize: 18 }}>
          قواعد احتساب الحضور لهذه الدورة
        </h2>
        <p className="small muted">
          المعمول به الآن: التأخر بعد {formatNumber(report.rules.late_percent_of_session)}٪ من مدة الجلسة، والخروج المبكر المسموح {formatNumber(report.rules.leave_grace_minutes)} دقائق، والاجتياز {formatNumber(report.rules.pass_percent)}٪.
          اترك الحقل فارغاً للعودة إلى القيمة الافتراضية. عند الحفظ تُعاد حسابات الجلسات السابقة وفق القواعد الجديدة (قراراتك اليدوية تبقى).
        </p>
        <AdminForm action={saveAttendanceSettingsAction.bind(null, slug, id)} submitLabel="حفظ القواعد">
          <div className="form-grid">
            <label htmlFor="late_percent">
              التأخر بعد <span className="hint">(٪ من مدة الجلسة، {limits.late_percent.min}–{limits.late_percent.max}؛ الافتراضي ١٠)</span>
              <input id="late_percent" name="late_percent" type="number" min={limits.late_percent.min} max={limits.late_percent.max} step={1} defaultValue={report.settings.late_percent ?? ''} placeholder="10" />
            </label>
            <label htmlFor="leave_grace_minutes">
              الخروج المبكر المسموح <span className="hint">(دقائق، {limits.leave_grace_minutes.min}–{limits.leave_grace_minutes.max}؛ الافتراضي ٥)</span>
              <input id="leave_grace_minutes" name="leave_grace_minutes" type="number" min={limits.leave_grace_minutes.min} max={limits.leave_grace_minutes.max} step={1} defaultValue={report.settings.leave_grace_minutes ?? ''} placeholder="5" />
            </label>
            <label htmlFor="pass_percent">
              حدّ اجتياز الحضور <span className="hint">(٪ من الجلسات، {limits.pass_percent.min}–{limits.pass_percent.max}؛ الافتراضي ٨٥)</span>
              <input id="pass_percent" name="pass_percent" type="number" min={limits.pass_percent.min} max={limits.pass_percent.max} step={1} defaultValue={report.settings.pass_percent ?? ''} placeholder="85" />
            </label>
          </div>
        </AdminForm>
      </section>

      {report.trainees.length > 0 && started.length > 0 && (
        <section className="card stack" aria-labelledby="adjust-heading">
          <h2 id="adjust-heading" style={{ fontSize: 18 }}>
            تعديل يدوي لحالة الحضور
          </h2>
          <p className="small muted">لحالات يؤكدها مسؤول (مثل: حضر ولم يُسجَّل لعطل في الرمز). يُسجَّل القرار بسببه وباسمك، ولا يستبدله الاحتساب التلقائي، ويمكنك التراجع عنه.</p>
          <AdminForm action={adjustAttendanceAction.bind(null, slug, id)} submitLabel="حفظ القرار">
            <div className="form-grid">
              <label htmlFor="adj-trainee">
                المتدرب
                <select id="adj-trainee" name="user_id" required defaultValue="">
                  <option value="" disabled>
                    اختر
                  </option>
                  {report.trainees.map((t) => (
                    <option key={t.user_id} value={t.user_id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="adj-session">
                الجلسة
                <select id="adj-session" name="session" required defaultValue="">
                  <option value="" disabled>
                    اختر
                  </option>
                  {started.map((s) => (
                    <option key={s.ref} value={`${s.kind}:${s.ref}`}>
                      {s.title} — {formatDateTime(s.starts_at)}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="adj-status">
                الحالة
                <select id="adj-status" name="status" defaultValue="PRESENT">
                  <option value="PRESENT">حاضر</option>
                  <option value="LATE">متأخر</option>
                  <option value="ABSENT">غائب</option>
                </select>
              </label>
              <label htmlFor="adj-note" className="full">
                السبب <span className="hint">(مطلوب، يظهر في التقرير)</span>
                <input id="adj-note" name="note" type="text" required minLength={3} maxLength={300} />
              </label>
            </div>
          </AdminForm>

          {adjustments.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3 style={{ fontSize: 15 }}>القرارات اليدوية الحالية</h3>
              {adjustments.map((a) =>
                a.session ? (
                  <div key={`${a.trainee.user_id}:${a.session.ref}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span className="small">
                      {a.trainee.name} · {a.session.title}: {STATUS[a.trainee.statuses[a.session.ref] ?? 'PENDING'][0]} — <span className="muted">{a.note}</span>
                    </span>
                    <DeleteButton
                      action={revertAttendanceAction.bind(null, slug, id, a.session.kind, a.session.ref, a.trainee.user_id)}
                      label="تراجع"
                      size="sm"
                      variant="primary"
                      confirmText="التراجع عن القرار اليدوي؟ يعود الاحتساب التلقائي."
                    />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}

      <p className="small muted">
        الحضور محسوب على الجلسات المنعقدة فقط. المتأخر يُحسب حاضراً في النسبة. الخروج قبل نهاية الجلسة المباشرة بأكثر من {report.rules.leave_grace_minutes} دقائق يُعدّ غياباً.
      </p>
    </>
  );
}
