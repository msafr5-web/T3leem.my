import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminCourse, type CourseRosterRow } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { enrollTraineesAction, importTraineesAction } from '@/lib/admin-actions';
import { formatDate, formatNumber } from '@/lib/format';
import { ImportEnrollForm, TypedEnrollForm } from './enroll-forms';

const statusLabel = { ACTIVE: 'فعّال', SUSPENDED: 'موقوف', EXPIRED: 'منتهٍ' } as const;

/** Course roster plus the two ways to add employees (typed grid, Excel/CSV). The academy's admin follows their own staff here. */
export default async function CourseEnrollments({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);

  let course: AdminCourse;
  let roster: CourseRosterRow[];
  try {
    [course, roster] = await Promise.all([admin.course(slug, token, id), admin.courseRoster(slug, token, id)]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }

  const completed = roster.filter((r) => r.completion_status === 'COMPLETED').length;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>المسجلون في «{course.title}»</h1>
          <p className="muted small">
            {formatNumber(roster.length)} مسجّل · {formatNumber(completed)} أتمّوا الدورة. يدخل الموظف بالبريد الإلكتروني برمز يصله، ولا حاجة لكلمة مرور.
          </p>
        </div>
        <div className="cta-row">
          <Link href={`/${slug}/dashboard/courses/${course.id}`} className="btn btn-ghost">رجوع للدورة</Link>
        </div>
      </div>

      <section className="card stack" aria-labelledby="add-typed">
        <h2 id="add-typed" style={{ fontSize: 18 }}>إضافة موظفين</h2>
        <p className="small muted">يُنشأ حساب لمن ليس له حساب ويُسجَّل في الدورة بلا دفع. إن كان في القائمة أي صف خاطئ لا يُسجَّل أحد، وتظهر الصفوف التي تحتاج تصحيحاً.</p>
        <TypedEnrollForm action={enrollTraineesAction.bind(null, slug, course.id)} />
      </section>

      <section className="card stack" aria-labelledby="add-file">
        <h2 id="add-file" style={{ fontSize: 18 }}>أو ارفع ملف Excel</h2>
        <ImportEnrollForm action={importTraineesAction.bind(null, slug, course.id)} templateHref={`/${slug}/dashboard/trainees/template`} />
      </section>

      <div className="table-wrap">
        {roster.length === 0 ? (
          <p className="empty">لا يوجد مسجلون في هذه الدورة بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>الجوال</th>
                <th>الرقم الوظيفي</th>
                <th className="num">التقدم</th>
                <th>الحالة</th>
                <th>تاريخ التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.enrollment_id}>
                  <td>
                    <Link href={`/${slug}/dashboard/trainees/${r.user_id}`}>{r.full_name ?? r.email}</Link>
                    {r.source === 'ADMIN' && <div className="small muted">أضافه المدير</div>}
                  </td>
                  <td className="ltr">{r.email}</td>
                  <td className="ltr">{r.phone ?? '—'}</td>
                  <td className="ltr">{r.employee_no ?? '—'}</td>
                  <td className="num">{formatNumber(r.progress_percentage)}%</td>
                  <td>
                    {r.completion_status === 'COMPLETED' ? <span className="badge ok">أتمّ الدورة</span> : <span className="badge">{statusLabel[r.status]}</span>}
                  </td>
                  <td className="small muted">{formatDate(r.enrolled_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
