import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createClassroomAction } from '@/lib/admin-actions';
import { classroomStatusLabel, formatDateTime, formatNumber, meetingProviderLabel } from '@/lib/format';
import Link from 'next/link';
import { AdminForm } from '../admin-form';
import { ClassroomFields } from './classroom-fields';

export default async function DashboardClassrooms({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const [classrooms, courses, trainers, integrations] = await Promise.all([
    admin.classrooms(slug, token),
    admin.courses(slug, token),
    admin.trainers(slug, token),
    admin.integrations(slug, token),
  ]);
  const now = Date.now();

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>الفصول الافتراضية</h1>
        <p className="muted small">
          جلسات مباشرة خاصة بأكاديميتك. رابط الانضمام لا يظهر في الصفحات العامة.{' '}
          {integrations.zoom ? <span className="badge ok">ربط Zoom التلقائي مفعّل</span> : <span className="badge">ربط Zoom يدوي</span>}
        </p>
      </div>

      <div className="table-wrap">
        {classrooms.length === 0 ? (
          <p className="empty">لا توجد فصول مجدولة.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الفصل</th>
                <th>الموعد (بتوقيت الرياض)</th>
                <th className="num">المدة</th>
                <th>المدرب</th>
                <th>المنصة</th>
                <th className="num">السعة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {classrooms.map((c) => {
                const past = new Date(c.starts_at).getTime() < now;
                return (
                  <tr key={c.id} style={past ? { opacity: 0.6 } : undefined}>
                    <td>
                      <Link href={`/${slug}/dashboard/classrooms/${c.id}`}>{c.title}</Link>
                      {c.course && <div className="small muted">{c.course.title}</div>}
                    </td>
                    <td className="small">{formatDateTime(c.starts_at)}</td>
                    <td className="num">{c.duration_minutes} د</td>
                    <td>{c.trainer?.full_name ?? '—'}</td>
                    <td>
                      {c.join_url ? (
                        <a href={c.join_url} target="_blank" rel="noopener noreferrer">
                          {meetingProviderLabel[c.provider]}
                        </a>
                      ) : (
                        meetingProviderLabel[c.provider]
                      )}
                    </td>
                    <td className="num">{c.capacity ? formatNumber(c.capacity) : '—'}</td>
                    <td>
                      <span className={`badge ${c.status === 'SCHEDULED' && !past ? 'ok' : ''}`}>{classroomStatusLabel[c.status]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <section className="card stack" aria-labelledby="add-classroom">
        <h2 id="add-classroom">جدولة فصل افتراضي</h2>
        <AdminForm action={createClassroomAction.bind(null, slug)} submitLabel="جدولة الفصل">
          <ClassroomFields courses={courses} trainers={trainers} zoomAutomated={integrations.zoom} />
        </AdminForm>
      </section>
    </>
  );
}
