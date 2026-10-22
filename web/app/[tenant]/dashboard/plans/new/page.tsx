import Link from 'next/link';
import { admin } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createPlanAction } from '@/lib/admin-actions';
import { formatNumber } from '@/lib/format';
import { AdminForm } from '../../admin-form';

export default async function NewPlan({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const token = await requireAdmin(slug);
  const courses = await admin.courses(slug, token);

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: 28 }}>خطة جديدة</h1>
        <Link href={`/${slug}/dashboard/plans`} className="btn btn-ghost">إلغاء</Link>
      </div>
      <div className="card">
        <AdminForm action={createPlanAction.bind(null, slug)} submitLabel="إنشاء الخطة">
          <div className="form-grid">
            <label htmlFor="title" className="full">
              عنوان الخطة
              <input id="title" name="title" type="text" required minLength={3} maxLength={200} placeholder="مثال: خطة التطوير القيادي ٢٠٢٧" />
            </label>
            <label htmlFor="type">
              نوع الخطة
              <select id="type" name="type" defaultValue="TRAINING">
                <option value="TRAINING">خطة تدريبية</option>
                <option value="DEVELOPMENT">خطة تطويرية</option>
              </select>
            </label>
            <label htmlFor="status">
              الحالة
              <select id="status" name="status" defaultValue="DRAFT">
                <option value="DRAFT">مسودة (لا تظهر للمتدربين)</option>
                <option value="ACTIVE">نشطة</option>
              </select>
            </label>
            <label htmlFor="starts_on">
              تاريخ البداية
              <input id="starts_on" name="starts_on" type="date" />
            </label>
            <label htmlFor="ends_on">
              تاريخ النهاية
              <input id="ends_on" name="ends_on" type="date" />
            </label>
            <label htmlFor="description" className="full">
              الوصف والهدف
              <textarea id="description" name="description" maxLength={5000} />
            </label>
          </div>

          <fieldset className="group">
            <legend>دورات الخطة (بالترتيب)</legend>
            {courses.length === 0 ? (
              <p className="small muted">لا توجد دورات. أضف دورات أولاً.</p>
            ) : (
              <div className="checklist">
                {courses.map((c) => (
                  <label key={c.id} htmlFor={`course-${c.id}`} className="check">
                    <input id={`course-${c.id}`} type="checkbox" name="course_ids" value={c.id} />
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
        </AdminForm>
      </div>
    </>
  );
}
