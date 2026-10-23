import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, admin, type AdminCourse, type ContentModule, type HlsStatus } from '@/lib/api';
import { requireAdmin } from '@/lib/admin';
import { createLessonAction, createModuleAction, deleteLessonAction, deleteModuleAction } from '@/lib/admin-actions';
import { lessonTypeLabel } from '@/lib/format';
import { AdminForm } from '../../../admin-form';
import { DeleteButton } from '../../../delete-button';
import { VideoUpload } from './video-upload';

const HLS_LABEL: Record<HlsStatus, { text: string; cls: string }> = {
  NONE: { text: 'لم يُرفع فيديو', cls: 'draft' },
  PROCESSING: { text: 'جارٍ التجهيز…', cls: '' },
  READY: { text: 'جاهز ومحمي', cls: 'ok' },
  FAILED: { text: 'فشلت المعالجة', cls: 'draft' },
};

const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB ?? 1024);

export default async function CourseContent({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const token = await requireAdmin(slug);

  let course: AdminCourse;
  let modules: ContentModule[];
  try {
    [course, modules] = await Promise.all([admin.course(slug, token, id), admin.content(slug, token, id)]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>محتوى الدورة</h1>
          <p className="muted small">{course.title}</p>
        </div>
        <Link href={`/${slug}/dashboard/courses/${id}`} className="btn btn-ghost">
          بيانات الدورة
        </Link>
      </div>

      <p className="notice sandbox small">
        فيديوهات الدروس تُشفّر تلقائياً (HLS بتشفير AES-128) ولا يمكن تنزيلها؛ لا يشاهدها إلا المتدربون المسجلون، وبروابط مؤقتة.
      </p>

      {modules.length === 0 && <div className="card empty">لا توجد وحدات بعد. أضف الوحدة الأولى أدناه.</div>}

      {modules.map((m, mi) => (
        <section key={m.id} className="card stack" aria-labelledby={`mod-${m.id}`}>
          <div className="page-head">
            <h2 id={`mod-${m.id}`} style={{ fontSize: 18 }}>
              <span className="muted num">الوحدة {mi + 1}: </span>
              {m.title}
            </h2>
            <DeleteButton
              action={deleteModuleAction.bind(null, slug, id, m.id)}
              label="حذف الوحدة"
              confirmText={`حذف وحدة «${m.title}» وكل دروسها وفيديوهاتها؟`}
            />
          </div>

          {m.lessons.length === 0 ? (
            <p className="small muted">لا دروس في هذه الوحدة.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الدرس</th>
                    <th>النوع</th>
                    <th>المحتوى</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {m.lessons.map((l) => (
                    <tr key={l.id}>
                      <td>{l.title}</td>
                      <td>{lessonTypeLabel[l.content_type]}</td>
                      <td style={{ minWidth: 240 }}>
                        {l.content_type === 'VIDEO' ? (
                          <div className="stack" style={{ gap: 6 }}>
                            <span className={`badge ${HLS_LABEL[l.hls_status].cls}`}>
                              {HLS_LABEL[l.hls_status].text}
                              {l.duration_seconds ? ` · ${Math.round(l.duration_seconds / 60)} د` : ''}
                            </span>
                            {l.hls_status === 'FAILED' && l.hls_error && <span className="small muted">{l.hls_error}</span>}
                            {l.hls_status !== 'PROCESSING' && <VideoUpload slug={slug} lessonId={l.id} maxMb={MAX_VIDEO_MB} />}
                          </div>
                        ) : l.media_url ? (
                          <a href={l.media_url} target="_blank" rel="noopener noreferrer" className="small">
                            فتح الرابط
                          </a>
                        ) : (
                          <span className="small muted">جلسة مباشرة</span>
                        )}
                      </td>
                      <td>
                        <DeleteButton action={deleteLessonAction.bind(null, slug, id, l.id)} label="حذف" confirmText={`حذف درس «${l.title}»؟`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
              + إضافة درس إلى هذه الوحدة
            </summary>
            <div style={{ marginTop: 12 }}>
              <AdminForm action={createLessonAction.bind(null, slug, id, m.id)} submitLabel="إضافة الدرس">
                <div className="form-grid">
                  <label htmlFor={`title-${m.id}`}>
                    عنوان الدرس
                    <input id={`title-${m.id}`} name="title" type="text" required minLength={2} maxLength={200} />
                  </label>
                  <label htmlFor={`type-${m.id}`}>
                    النوع
                    <select id={`type-${m.id}`} name="content_type" defaultValue="VIDEO">
                      <option value="VIDEO">فيديو (يُرفع بعد الإضافة)</option>
                      <option value="PDF">ملف PDF</option>
                      <option value="ZOOM">جلسة مباشرة</option>
                    </select>
                  </label>
                  <label htmlFor={`url-${m.id}`} className="full">
                    رابط الملف <span className="hint">(لدروس PDF فقط، https)</span>
                    <input id={`url-${m.id}`} name="media_url" type="url" dir="ltr" placeholder="https://…" />
                  </label>
                </div>
              </AdminForm>
            </div>
          </details>
        </section>
      ))}

      <section className="card stack" aria-labelledby="add-module">
        <h2 id="add-module" style={{ fontSize: 18 }}>
          إضافة وحدة
        </h2>
        <AdminForm action={createModuleAction.bind(null, slug, id)} submitLabel="إضافة الوحدة">
          <label htmlFor="module-title">
            عنوان الوحدة
            <input id="module-title" name="title" type="text" required minLength={2} maxLength={200} placeholder="مثال: الأسبوع الأول — المفاهيم الأساسية" />
          </label>
        </AdminForm>
      </section>
    </>
  );
}
