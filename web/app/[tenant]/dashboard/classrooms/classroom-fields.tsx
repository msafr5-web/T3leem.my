import type { AdminCourse, AdminTrainer, Classroom } from '@/lib/api';

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Riyadh time (UTC+3, no DST) for <input type="datetime-local">. */
const toRiyadhLocal = (iso: string): string => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16);

export function ClassroomFields({
  courses,
  trainers,
  classroom,
  zoomAutomated,
}: {
  courses: AdminCourse[];
  trainers: AdminTrainer[];
  classroom?: Classroom;
  zoomAutomated: boolean;
}) {
  return (
    <div className="form-grid">
      <label htmlFor="title" className="full">
        عنوان الجلسة
        <input id="title" name="title" type="text" required minLength={3} maxLength={200} defaultValue={classroom?.title} />
      </label>
      <label htmlFor="starts_at">
        الموعد <span className="hint">(بتوقيت الرياض)</span>
        <input id="starts_at" name="starts_at" type="datetime-local" required defaultValue={classroom ? toRiyadhLocal(classroom.starts_at) : undefined} />
      </label>
      <label htmlFor="duration_minutes">
        المدة (دقيقة)
        <input id="duration_minutes" name="duration_minutes" type="number" min={15} max={720} step={15} defaultValue={classroom?.duration_minutes ?? 60} required />
      </label>
      <label htmlFor="course_id">
        الدورة
        <select id="course_id" name="course_id" defaultValue={classroom?.course?.id ?? ''}>
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
        <select id="trainer_id" name="trainer_id" defaultValue={classroom?.trainer?.id ?? ''}>
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
        <select id="provider" name="provider" defaultValue={classroom?.provider ?? 'ZOOM'}>
          <option value="ZOOM">Zoom</option>
          <option value="TEAMS">Microsoft Teams</option>
          <option value="GOOGLE_MEET">Google Meet</option>
          <option value="OTHER">أخرى</option>
        </select>
      </label>
      <label htmlFor="capacity">
        السعة القصوى
        <input id="capacity" name="capacity" type="number" min={1} max={10000} defaultValue={classroom?.capacity ?? ''} />
      </label>
      {classroom && (
        <label htmlFor="status">
          الحالة
          <select id="status" name="status" defaultValue={classroom.status}>
            <option value="SCHEDULED">مجدول</option>
            <option value="COMPLETED">منتهٍ</option>
            <option value="CANCELLED">ملغى</option>
          </select>
        </label>
      )}
      <label htmlFor="join_url" className="full">
        رابط الانضمام <span className="hint">(https فقط)</span>
        <input id="join_url" name="join_url" type="url" dir="ltr" placeholder="https://zoom.us/j/…" defaultValue={classroom?.join_url ?? ''} />
        <span className="hint">
          {zoomAutomated
            ? 'اتركه فارغاً مع اختيار Zoom وسيُنشأ الاجتماع ورابطه تلقائياً.'
            : 'ربط Zoom التلقائي غير مفعّل على هذا الخادم: ألصق رابط الاجتماع يدوياً.'}
        </span>
      </label>
    </div>
  );
}
