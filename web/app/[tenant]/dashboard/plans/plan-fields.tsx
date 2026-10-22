import type { AdminCourse, Plan } from '@/lib/api';
import { formatNumber } from '@/lib/format';

export function PlanFields({ courses, plan }: { courses: AdminCourse[]; plan?: Plan }) {
  const selected = new Set(plan?.courses.map((c) => c.id));
  return (
    <>
      <div className="form-grid">
        <label htmlFor="title" className="full">
          عنوان الخطة
          <input id="title" name="title" type="text" required minLength={3} maxLength={200} placeholder="مثال: خطة التطوير القيادي ٢٠٢٧" defaultValue={plan?.title} />
        </label>
        <label htmlFor="type">
          نوع الخطة
          <select id="type" name="type" defaultValue={plan?.type ?? 'TRAINING'}>
            <option value="TRAINING">خطة تدريبية</option>
            <option value="DEVELOPMENT">خطة تطويرية</option>
          </select>
        </label>
        <label htmlFor="status">
          الحالة
          <select id="status" name="status" defaultValue={plan?.status ?? 'DRAFT'}>
            <option value="DRAFT">مسودة (لا تظهر للمتدربين)</option>
            <option value="ACTIVE">نشطة</option>
            <option value="ARCHIVED">مؤرشفة</option>
          </select>
        </label>
        <label htmlFor="starts_on">
          تاريخ البداية
          <input id="starts_on" name="starts_on" type="date" defaultValue={plan?.starts_on ?? ''} />
        </label>
        <label htmlFor="ends_on">
          تاريخ النهاية
          <input id="ends_on" name="ends_on" type="date" defaultValue={plan?.ends_on ?? ''} />
        </label>
        <label htmlFor="description" className="full">
          الوصف والهدف
          <textarea id="description" name="description" maxLength={5000} defaultValue={plan?.description ?? ''} />
        </label>
      </div>

      <fieldset className="group">
        <legend>دورات الخطة</legend>
        {courses.length === 0 ? (
          <p className="small muted">لا توجد دورات. أضف دورات أولاً.</p>
        ) : (
          <div className="checklist">
            {courses.map((c) => (
              <label key={c.id} htmlFor={`course-${c.id}`} className="check">
                <input id={`course-${c.id}`} type="checkbox" name="course_ids" value={c.id} defaultChecked={selected.has(c.id)} />
                {c.title}
                <span className="hint">
                  {c.training_hours !== null ? `${formatNumber(c.training_hours)} ساعة` : ''}
                  {!c.is_published ? ' · غير منشورة' : ''}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </>
  );
}
