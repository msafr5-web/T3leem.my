import type { AdminCourse, AdminTrainer } from '@/lib/api';
import type { AdminFormState } from '@/lib/admin-actions';
import { AdminForm } from '../admin-form';

/** Create/edit form for a course, including its regulatory data (license, accreditation, hours). */
export function CourseForm({
  action,
  trainers,
  course,
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  trainers: AdminTrainer[];
  course?: AdminCourse;
}) {
  return (
    <AdminForm action={action} submitLabel={course ? 'حفظ التعديلات' : 'إضافة الدورة'}>
      <fieldset className="group">
        <legend>معلومات الدورة</legend>
        <div className="form-grid">
          <label htmlFor="title" className="full">
            عنوان الدورة
            <input id="title" name="title" type="text" required minLength={3} maxLength={200} defaultValue={course?.title} />
          </label>
          <label htmlFor="type">
            نوع الدورة
            <select id="type" name="type" defaultValue={course?.type ?? 'RECORDED'}>
              <option value="RECORDED">دورة مسجلة</option>
              <option value="LIVE">بث مباشر</option>
            </select>
          </label>
          <label htmlFor="trainer_id">
            المدرب
            <select id="trainer_id" name="trainer_id" required defaultValue={course?.trainer.id ?? ''}>
              <option value="" disabled>
                اختر المدرب
              </option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="description" className="full">
            الوصف
            <textarea id="description" name="description" maxLength={5000} defaultValue={course?.description ?? ''} />
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>المدة والساعات والسعر</legend>
        <div className="form-grid">
          <label htmlFor="training_hours">
            عدد الساعات التدريبية
            <input id="training_hours" name="training_hours" type="number" min={0.5} max={2000} step={0.5} defaultValue={course?.training_hours ?? ''} />
          </label>
          <label htmlFor="duration_days">
            مدة الدورة (أيام)
            <input id="duration_days" name="duration_days" type="number" min={1} max={730} step={1} defaultValue={course?.duration_days ?? ''} />
          </label>
          <label htmlFor="price">
            السعر قبل الضريبة (ر.س)
            <input id="price" name="price" type="number" min={0} step={0.01} required defaultValue={course?.price.net ?? ''} />
            <span className="hint">تُضاف ضريبة القيمة المضافة ١٥٪ تلقائياً عند العرض والشراء.</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>الترخيص والاعتماد</legend>
        <div className="form-grid">
          <label htmlFor="license_number">
            رقم الترخيص
            <input id="license_number" name="license_number" type="text" maxLength={100} dir="ltr" defaultValue={course?.license.number ?? ''} />
          </label>
          <label htmlFor="license_authority">
            جهة الترخيص
            <input
              id="license_authority"
              name="license_authority"
              type="text"
              maxLength={200}
              placeholder="مثال: المؤسسة العامة للتدريب التقني والمهني"
              defaultValue={course?.license.authority ?? ''}
            />
          </label>
          <label htmlFor="license_expires_on">
            تاريخ انتهاء الترخيص
            <input id="license_expires_on" name="license_expires_on" type="date" defaultValue={course?.license.expires_on ?? ''} />
          </label>
          <label htmlFor="accreditation_number">
            رقم الاعتماد
            <input id="accreditation_number" name="accreditation_number" type="text" maxLength={100} dir="ltr" defaultValue={course?.accreditation_number ?? ''} />
          </label>
        </div>
      </fieldset>

      <label htmlFor="is_published" className="check">
        <input id="is_published" name="is_published" type="checkbox" defaultChecked={course?.is_published ?? false} />
        نشر الدورة للمتدربين
      </label>
    </AdminForm>
  );
}
