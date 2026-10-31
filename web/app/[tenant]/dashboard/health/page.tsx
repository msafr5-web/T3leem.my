import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addHealthSectorAction,
  deleteHealthQuestionAction,
  deleteHealthSectorAction,
  grantHealthAccessAction,
  importHealthAction,
  installHealthStarterAction,
  saveHealthQuestionAction,
  saveHealthSettingsAction,
  updateHealthSectorAction,
} from '@/lib/admin-actions';
import { admin } from '@/lib/api';
import { formatNumber, isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { DeleteButton } from '../delete-button';
import { ActionForm, ConfirmAction, HealthImportForm, QuestionEditor } from './health-forms';

export const metadata: Metadata = { title: 'الشهادات الصحية' };

const PAGE = 25;
const NOTICES: Record<string, string> = {
  saved: 'تم الحفظ.',
  sectors: 'تم تحديث القطاعات.',
  granted: 'تم تفعيل اشتراك المتدرب.',
  starter: 'تم تثبيت بنك الأسئلة الأولي.',
};

/** ISO instant → the value of a datetime-local input in Saudi time (UTC+3, no daylight saving). */
const toRiyadhInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 16) : '');

export default async function HealthAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ sector?: string; q?: string; page?: string; saved?: string; sectors?: string; granted?: string; starter?: string }>;
}) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/dashboard/health`)}`);
  if (session.role !== 'TENANT_ADMIN') redirect(`/${slug}`);

  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (sp.sector) qs.set('sector_id', sp.sector);
  if (sp.q) qs.set('q', sp.q.slice(0, 100));

  const [overview, questions] = await Promise.all([admin.health(slug, session.token), admin.healthQuestions(slug, session.token, qs.toString())]);
  const { settings, sectors } = overview;
  const totalQuestions = sectors.reduce((n, s) => n + s.total_count, 0);
  const notice = (['saved', 'sectors', 'granted', 'starter'] as const).map((k) => (sp[k] ? NOTICES[k] : null)).find(Boolean);
  const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
  const pages = Math.max(1, Math.ceil(questions.total / PAGE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (sp.sector) u.set('sector', sp.sector);
    if (sp.q) u.set('q', sp.q);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/${slug}/dashboard/health${s ? `?${s}` : ''}#questions`;
  };

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>الشهادات الصحية</h1>
          <p className="muted">بنك أسئلة تدريبي مقسّم حسب القطاع. تدير قطاعاته وأسئلته وفترته التجريبية ورسومه من هنا.</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/${slug}/health`} className="btn btn-ghost">
            معاينة كما يراها المتدرب
          </Link>
          <a href={`/${slug}/dashboard/health/export`} className="btn btn-ghost">
            تصدير الأسئلة
          </a>
          <a href={`/${slug}/dashboard/health/export?template=1`} className="btn btn-ghost">
            قالب Excel
          </a>
        </div>
      </div>

      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}

      <section className="card stack" aria-labelledby="settings-h">
        <h2 id="settings-h">الإتاحة والفترة التجريبية والرسوم</h2>
        <ActionForm action={saveHealthSettingsAction.bind(null, slug)} submitLabel="حفظ الإعدادات">
          <label className="check">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
            تفعيل القسم للمتدربين
          </label>
          <label>
            نهاية الفترة التجريبية <span className="hint">(بتوقيت السعودية، اتركه فارغاً لتبقى مفتوحة)</span>
            <input type="datetime-local" name="trial_ends_at" defaultValue={toRiyadhInput(settings.trial_ends_at)} />
          </label>
          <label>
            الرسوم بعد الفترة التجريبية (ريال) <span className="hint">(اتركها فارغة لتبقى مجانية)</span>
            <input type="number" name="price" min={0} max={100000} step="0.01" defaultValue={settings.price ?? ''} inputMode="decimal" />
          </label>
          <fieldset className="group" style={{ padding: 10 }}>
            <legend className="small">وضع الاختبارات الرسمية</legend>
            <label className="check">
              <input type="checkbox" name="strict_mode" defaultChecked={settings.strict_mode} />
              تفعيل الوضع الصارم: تسجيل بالاسم والجوال والبريد (لا يتكرر الجوال ولا البريد)، واختبارات رسمية فقط (دون تدريب أو كشف للإجابات)، ورمز يصل إلى بريد المشترك قبل كل اختبار، وسقف يومي
            </label>
            <label>
              الحد الأقصى للاختبارات اليومية <span className="hint">(بعده يتوقف المشترك حتى مرور ٢٤ ساعة من آخر محاولة)</span>
              <input type="number" name="daily_limit" min={1} max={50} defaultValue={settings.daily_limit} />
            </label>
            <label>
              عدد أسئلة الاختبار الواحد
              <input type="number" name="questions_per_exam" min={1} max={100} defaultValue={settings.questions_per_exam} />
            </label>
          </fieldset>
        </ActionForm>
        <p className="small muted">بعد انتهاء الفترة التجريبية يُمنع المتدرب الذي لم يُفعَّل اشتراكه. المشتركون الفعّالون الآن: {formatNumber(overview.active_subscribers)}.</p>
        <details>
          <summary>تفعيل اشتراك متدرب يدوياً</summary>
          <ActionForm action={grantHealthAccessAction.bind(null, slug)} submitLabel="تفعيل الاشتراك">
            <label>
              بريد المتدرب
              <input type="email" name="email" required dir="ltr" />
            </label>
            <label>
              المدة (أيام)
              <input type="number" name="days" min={1} max={3650} defaultValue={365} required />
            </label>
          </ActionForm>
        </details>
      </section>

      <section className="card stack" aria-labelledby="sectors-h">
        <h2 id="sectors-h">القطاعات</h2>
        {sectors.length === 0 ? (
          <div className="notice">لا توجد قطاعات بعد. ثبّت بنك الأسئلة الأولي (٦ قطاعات و٦٦٠ سؤالاً) أو أضف قطاعاً جديداً.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {sectors.map((s) => (
              <details key={s.id} className="card" style={{ padding: 12 }}>
                <summary>
                  <strong>{s.name}</strong> · {formatNumber(s.question_count)} سؤالاً ظاهراً{s.total_count !== s.question_count ? ` (من ${formatNumber(s.total_count)})` : ''}
                  {!s.active && <span className="badge"> مخفي</span>}
                </summary>
                <div className="stack" style={{ marginTop: 12 }}>
                  <ActionForm action={updateHealthSectorAction.bind(null, slug, s.id)} submitLabel="حفظ القطاع">
                    <label>
                      الاسم
                      <input type="text" name="name" defaultValue={s.name} required maxLength={80} />
                    </label>
                    <label>
                      الوصف
                      <input type="text" name="title" defaultValue={s.title} maxLength={200} />
                    </label>
                    <label>
                      الترتيب
                      <input type="number" name="sort_order" defaultValue={s.sort_order} min={0} max={1000} />
                    </label>
                    <label className="check">
                      <input type="checkbox" name="active" defaultChecked={s.active} />
                      ظاهر للمتدربين
                    </label>
                  </ActionForm>
                  <DeleteButton action={deleteHealthSectorAction.bind(null, slug, s.id)} label="حذف القطاع" confirmText={`حذف قطاع «${s.name}»؟ لا يمكن حذفه إن كان فيه أسئلة.`} />
                </div>
              </details>
            ))}
          </div>
        )}
        <details>
          <summary>إضافة قطاع جديد</summary>
          <ActionForm action={addHealthSectorAction.bind(null, slug)} submitLabel="إضافة القطاع">
            <label>
              اسم القطاع
              <input type="text" name="name" required maxLength={80} />
            </label>
            <label>
              وصف (اختياري)
              <input type="text" name="title" maxLength={200} />
            </label>
          </ActionForm>
        </details>
        <ConfirmAction
          action={installHealthStarterAction.bind(null, slug)}
          label={totalQuestions === 0 ? 'تثبيت بنك الأسئلة الأولي (٦ قطاعات، ٦٦٠ سؤالاً)' : 'تحديث البنك الأولي'}
          confirmText="سيُضاف البنك الأولي (٦٦٠ سؤالاً في ٦ قطاعات). الأسئلة التي أضفتها أنت لن تُمس، أما الأسئلة الأولية التي عدّلتها فتعود إلى نصها الأصلي. متابعة؟"
          variant="ghost"
        />
      </section>

      <section className="card stack" aria-labelledby="import-h">
        <h2 id="import-h">استيراد الأسئلة من Excel</h2>
        <p className="small muted">
          حمّل <a href={`/${slug}/dashboard/health/export?template=1`}>القالب</a>، عبّئه (قطاع، سؤال، من ٢ إلى ٦ خيارات، الإجابة الصحيحة، شرح)، ثم ارفعه. إن وُجد خطأ في أي صف لا يُستورد شيء.
        </p>
        <HealthImportForm action={importHealthAction.bind(null, slug)} />
      </section>

      <section className="stack" aria-labelledby="questions-h" id="questions">
        <h2 id="questions-h">الأسئلة ({formatNumber(questions.total)})</h2>
        <form method="get" className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select name="sector" defaultValue={sp.sector ?? ''} aria-label="القطاع">
            <option value="">كل القطاعات</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder="بحث بنص السؤال أو رقمه" maxLength={100} aria-label="بحث" />
          <button type="submit" className="btn btn-ghost">
            تصفية
          </button>
        </form>

        {sectors.length > 0 && (
          <details className="card" style={{ padding: 12 }}>
            <summary>
              <strong>إضافة سؤال جديد</strong>
            </summary>
            <div style={{ marginTop: 12 }}>
              <QuestionEditor action={saveHealthQuestionAction.bind(null, slug, null)} sectors={sectors} defaultSectorId={sp.sector} submitLabel="إضافة السؤال" />
            </div>
          </details>
        )}

        {questions.questions.length === 0 ? (
          <div className="card empty">لا توجد أسئلة مطابقة.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {questions.questions.map((q) => (
              <details key={q.id} className="card" style={{ padding: 12 }}>
                <summary>
                  <span className="small muted">
                    {sectorName.get(q.sector_id)} · {q.code}
                  </span>
                  {!q.active && <span className="badge"> مخفي</span>}
                  <br />
                  {q.body}
                </summary>
                <div className="stack" style={{ marginTop: 12 }}>
                  <QuestionEditor action={saveHealthQuestionAction.bind(null, slug, q.id)} sectors={sectors} question={q} submitLabel="حفظ السؤال" />
                  <DeleteButton action={deleteHealthQuestionAction.bind(null, slug, q.id)} label="حذف السؤال" confirmText="حذف هذا السؤال نهائياً؟ للإخفاء فقط ألغِ «ظاهر للمتدربين»." />
                </div>
              </details>
            ))}
          </div>
        )}

        {pages > 1 && (
          <nav className="row" style={{ gap: 8, justifyContent: 'center' }} aria-label="الصفحات">
            {page > 1 && (
              <Link href={link(page - 1)} className="btn btn-ghost">
                السابق
              </Link>
            )}
            <span className="small muted">
              صفحة {formatNumber(page)} من {formatNumber(pages)}
            </span>
            {page < pages && (
              <Link href={link(page + 1)} className="btn btn-ghost">
                التالي
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
