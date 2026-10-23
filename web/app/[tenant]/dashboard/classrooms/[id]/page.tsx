import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type Classroom } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { deleteAction, updateClassroomAction } from '@/lib/admin-actions';
import { AdminForm } from '../../admin-form';
import { DeleteButton } from '../../delete-button';
import { formatDateTime } from '@/lib/format';
import { ClassroomFields } from '../classroom-fields';

export default async function EditClassroom({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);

  let classroom: Classroom;
  try {
    classroom = await admin.classroom(slug, token, id);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const [courses, trainers, integrations, attendance] = await Promise.all([
    admin.courses(slug, token),
    admin.trainers(slug, token),
    admin.integrations(slug, token),
    admin.attendance(slug, token, id),
  ]);

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>تعديل الفصل الافتراضي</h1>
        <div className="cta-row">
          {classroom.join_url && (
            <a href={classroom.join_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              فتح رابط الجلسة
            </a>
          )}
          <Link href={`/${slug}/dashboard/classrooms`} className="btn btn-ghost">رجوع</Link>
        </div>
      </div>
      <div className="card">
        <AdminForm action={updateClassroomAction.bind(null, slug, classroom.id)} submitLabel="حفظ التعديلات">
          <ClassroomFields courses={courses} trainers={trainers} classroom={classroom} zoomAutomated={integrations.zoom} />
        </AdminForm>
      </div>
      <section className="card stack" aria-labelledby="attendance-heading">
        <h2 id="attendance-heading" style={{ fontSize: 18 }}>الحضور ({attendance.length})</h2>
        <p className="small muted">يُسجَّل تلقائياً من Zoom عند انضمام كل مشارك (يتطلب ضبط إشعارات Zoom).</p>
        {attendance.length === 0 ? (
          <p className="small muted">لم يُسجَّل حضور بعد.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشارك</th>
                  <th>البريد</th>
                  <th>وقت الانضمام</th>
                  <th>متدرب مسجّل</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={`${a.email ?? a.name}-${a.joined_at}`}>
                    <td>{a.name}</td>
                    <td className="ltr">{a.email ?? '—'}</td>
                    <td className="small">{formatDateTime(a.joined_at)}</td>
                    <td>{a.is_trainee ? <span className="badge ok">نعم</span> : <span className="badge">ضيف</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" style={{ fontSize: 18 }}>حذف الفصل</h2>
        <p className="small muted">إذا أُنشئ الاجتماع عبر Zoom تلقائياً فسيُحذف من Zoom أيضاً. لإبقاء السجل استخدم حالة «ملغى» بدلاً من الحذف.</p>
        <DeleteButton action={deleteAction.bind(null, slug, 'classrooms', classroom.id)} label="حذف الفصل" confirmText={`حذف «${classroom.title}»؟`} />
      </section>
    </>
  );
}
