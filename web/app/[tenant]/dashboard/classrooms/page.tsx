import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createClassroomAction } from '@/lib/admin-actions';
import { classroomStatusLabel, formatDateTime, formatNumber, meetingProviderLabel } from '@/lib/format';
import { AdminForm } from '../admin-form';

export default async function DashboardClassrooms({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const [classrooms, courses, trainers] = await Promise.all([admin.classrooms(slug, token), admin.courses(slug, token), admin.trainers(slug, token)]);
  const now = Date.now();

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 28 }}>الفصول الافتراضية</h1>
        <p className="muted small">جلسات مباشرة خاصة بأكاديميتك. رابط الانضمام لا يظهر في الصفحات العامة.</p>
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
                      {c.title}
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
          <div className="form-grid">
            <label htmlFor="title" className="full">
              عنوان الجلسة
              <input id="title" name="title" type="text" required minLength={3} maxLength={200} />
            </label>
            <label htmlFor="starts_at">
              الموعد <span className="hint">(بتوقيت الرياض)</span>
              <input id="starts_at" name="starts_at" type="datetime-local" required />
            </label>
            <label htmlFor="duration_minutes">
              المدة (دقيقة)
              <input id="duration_minutes" name="duration_minutes" type="number" min={15} max={720} step={15} defaultValue={60} required />
            </label>
            <label htmlFor="course_id">
              الدورة
              <select id="course_id" name="course_id" defaultValue="">
                <option value="">بدون دورة محددة</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="trainer_id">
              المدرب
              <select id="trainer_id" name="trainer_id" defaultValue="">
                <option value="">بدون مدرب محدد</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="provider">
              المنصة
              <select id="provider" name="provider" defaultValue="ZOOM">
                <option value="ZOOM">Zoom</option>
                <option value="TEAMS">Microsoft Teams</option>
                <option value="GOOGLE_MEET">Google Meet</option>
                <option value="OTHER">أخرى</option>
              </select>
            </label>
            <label htmlFor="capacity">
              السعة القصوى
              <input id="capacity" name="capacity" type="number" min={1} max={10000} />
            </label>
            <label htmlFor="join_url" className="full">
              رابط الانضمام <span className="hint">(https فقط)</span>
              <input id="join_url" name="join_url" type="url" dir="ltr" placeholder="https://zoom.us/j/…" />
            </label>
          </div>
        </AdminForm>
      </section>
    </>
  );
}
