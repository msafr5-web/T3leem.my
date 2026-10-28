'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AdminCourse, AdminTrainer } from '@/lib/api';
import type { AdminFormState } from '@/lib/admin-actions';
import { formatDateTime } from '@/lib/format';
import { AdminForm } from '../admin-form';
import { SourceFields } from '../recorded/source-fields';
import { YoutubeUrlField } from '../recorded/youtube-url-field';

/**
 * The YouTube part of a recorded course: on a new (or still empty) course, a video link + how
 * to split it; on a course already built from YouTube, its channel and start date/time.
 */
function RecordedSection({ slug, course }: { slug: string; course?: AdminCourse }) {
  if (course?.recorded) {
    const r = course.recorded;
    return (
      <fieldset className="group">
        <legend>مصدر الدورة المسجلة (YouTube)</legend>
        <input type="hidden" name="recorded_course" value="1" />
        <p className="small">
          الفيديو:{' '}
          <a href={`https://www.youtube.com/watch?v=${r.video_id}`} target="_blank" rel="noopener noreferrer" className="ltr">
            youtube.com/watch?v={r.video_id}
          </a>{' '}
          · {r.day_count} {r.day_count === 1 ? 'يوم' : 'أيام'} · <Link href={`/${slug}/dashboard/recorded/${course.id}`}>الجدولة والنقاش</Link>
          {r.starts_at && <> · يبدأ {formatDateTime(r.starts_at)}</>}
        </p>
        <div className="form-grid">
          <SourceFields channelUrl={r.channel_url} channelName={r.channel_name} startsAt={r.starts_at} />
        </div>
      </fieldset>
    );
  }
  if (course?.has_content) {
    return (
      <p className="notice sandbox small">
        لهذه الدورة محتوى مُضاف يدوياً، لذلك لا يمكن ربطها بفيديو YouTube. لإنشاء دورة مسجلة من YouTube أنشئ دورة جديدة أو استخدم قسم{' '}
        <Link href={`/${slug}/dashboard/recorded/new`}>دورات مسجلة</Link>.
      </p>
    );
  }
  return (
    <fieldset className="group">
      <legend>مصدر الدورة المسجلة (YouTube)</legend>
      <p className="small muted">
        الصق رابط الفيديو لتحسب المنصة مدته وتقسّمه تلقائياً إلى أيام وأجزاء بينها استراحات. اتركه فارغاً إن كنت سترفع الفيديوهات بنفسك.
      </p>
      <div className="form-grid">
        <YoutubeUrlField />
        <label htmlFor="split_mode">
          طريقة التقسيم
          <select id="split_mode" name="split_mode" defaultValue="fixed">
            <option value="fixed">ثابتة: استراحة كل «طول الجزء» بالضبط</option>
            <option value="balanced">متوازنة: أجزاء متساوية</option>
          </select>
        </label>
        <label htmlFor="max_lecture_minutes">
          طول الجزء <span className="hint">(دقائق، مثل ٢٥ أو ٣٠)</span>
          <input id="max_lecture_minutes" name="max_lecture_minutes" type="number" min={3} max={60} defaultValue={25} />
        </label>
        <label htmlFor="break_minutes">
          الاستراحة بين الأجزاء <span className="hint">(دقائق)</span>
          <input id="break_minutes" name="break_minutes" type="number" min={0} max={30} defaultValue={5} />
        </label>
        <label htmlFor="discussion_minutes">
          النقاش في نهاية اليوم <span className="hint">(دقائق)</span>
          <input id="discussion_minutes" name="discussion_minutes" type="number" min={0} max={60} defaultValue={15} />
        </label>
        <label htmlFor="days">
          عدد الأيام <span className="hint">(فارغ = تلقائي: ساعة فيديو يومياً)</span>
          <input id="days" name="days" type="number" min={1} max={60} />
        </label>
        <SourceFields />
      </div>
      <p className="small muted">
        لمعاينة الأيام والأجزاء قبل الحفظ استخدم قسم <Link href={`/${slug}/dashboard/recorded/new`}>دورات مسجلة</Link>.
      </p>
    </fieldset>
  );
}

/** Create/edit form for a course, including its regulatory data (license, accreditation, hours). */
export function CourseForm({
  slug,
  action,
  trainers,
  course,
}: {
  slug: string;
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  trainers: AdminTrainer[];
  course?: AdminCourse;
}) {
  const [type, setType] = useState<'RECORDED' | 'LIVE'>(course?.type ?? 'RECORDED');

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
            <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as 'RECORDED' | 'LIVE')} disabled={!!course?.recorded}>
              <option value="RECORDED">دورة مسجلة</option>
              <option value="LIVE">بث مباشر</option>
            </select>
            {/* A disabled select isn't submitted: keep the value for recorded YouTube courses. */}
            {course?.recorded && <input type="hidden" name="type" value="RECORDED" />}
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

      {type === 'RECORDED' && <RecordedSection slug={slug} course={course} />}

      <fieldset className="group">
        <legend>المدة والساعات والسعر</legend>
        <div className="form-grid">
          <label htmlFor="training_hours">
            عدد الساعات التدريبية
            <input id="training_hours" name="training_hours" type="number" min={0.5} max={2000} step={0.5} defaultValue={course?.training_hours ?? ''} />
            {type === 'RECORDED' && !course?.recorded && <span className="hint">مع رابط YouTube تُحسب تلقائياً إن تركتها فارغة.</span>}
          </label>
          <label htmlFor="duration_days">
            مدة الدورة (أيام)
            <input id="duration_days" name="duration_days" type="number" min={1} max={730} step={1} defaultValue={course?.duration_days ?? ''} />
          </label>
          <label htmlFor="price">
            السعر قبل الضريبة (ر.س)
            <input id="price" name="price" type="number" min={0} step={0.01} required defaultValue={course?.price.net ?? ''} />
            <span className="hint">تُضاف ضريبة القيمة المضافة ١٥٪ تلقائياً عند العرض والشراء. ٠ = دورة مجانية.</span>
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
