import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { approveCostPolicyAction, deleteReadingAction, discardCostDraftAction, saveCostPolicyAction, saveReadingAction } from '@/lib/institute-actions';
import { ApiError, admin, type CostPolicy, type CostPolicyParams } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
/** Counts use Latin digits in the institute workspace (readable and tabular, like the amounts). */
const formatNumber = (n: number) => n.toLocaleString('ar-SA-u-nu-latn');
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../../dashboard/health/health-forms';
import { getInstituteMe } from '../ix-data';

export const metadata: Metadata = { title: 'تكاليف المعهد' };

const NOTICES: Record<string, string> = { draft: 'حُفظت مسودة السياسة. لم تُعتمد بعد.', approved: 'اعتُمدت السياسة. التقارير القادمة تُبنى عليها.', discarded: 'حُذفت المسودة.', reading: 'تم تحديث قراءات العدادات.' };
const ALLOCATION: Record<string, string> = { AREA: 'بالمساحة', POWER_HOURS: 'بقدرة الأجهزة × ساعات التشغيل الفعلية', METER: 'بقراءات العدادات الفرعية (والباقي بالمساحة)' };
const CATEGORY: Record<string, string> = { COMMERCIAL: 'تجاري (يشمل المعاهد والمدارس الأهلية)', GOVERNMENT: 'حكومي', INDUSTRIAL: 'صناعي', AGRICULTURAL: 'زراعي', CHARITY: 'جمعيات خيرية' };
const WARNING: Record<string, string> = {
  NO_BILL: 'لا توجد فاتورة كهرباء لهذا الشهر: كهرباء القاعات صفر.',
  BILL_NET_OF_VAT_ESTIMATED: 'الضريبة غير مدخلة في الفاتورة: حُسبت تقديرياً من النسبة لخصمها. أدخل الضريبة المذكورة في الفاتورة للدقة.',
  REVENUE_BASIS_NOT_IFRS15: 'أساس الإيراد «المحصَّل» رأي إداري، وليس وفق IFRS 15 (التحقق عبر الزمن).',
  NO_USAGE_FALLBACK_AREA: 'لم تُنفَّذ حصص في الشهر، فوُزّعت الكهرباء بالمساحة.',
  NO_BILL_KWH_FALLBACK_POWER_HOURS: 'لا توجد قراءات عدادات أو كيلوواط ساعة في الفاتورة، فوُزّعت بالقدرة × الساعات.',
  READINGS_EXCEED_BILL_KWH: 'قراءات العدادات أكبر من استهلاك الفاتورة: استُعملت كنسب فقط.',
  ROOM_POWER_MISSING: 'قاعة نُفِّذت فيها حصص وقدرتها غير مدخلة: لا تتحمل كهرباء.',
  ROOM_AREA_MISSING: 'قاعة بلا مساحة مدخلة.',
  ASSET_NO_PURCHASE_DATE: 'أصل بلا تاريخ شراء: لا يُهلَك.',
  ASSET_RETIRED_WITHOUT_DATE: 'أصل «خارج الخدمة» بلا تاريخ إخراج: لا يُهلَك.',
  ASSET_NO_COST: 'أصل بلا قيمة شراء: لا يُهلَك.',
  NO_ROOMS: 'لا توجد قاعات في الفرع.',
  NO_PROGRAM_HOURS: 'برنامج بلا ساعات مواد: لا يمكن إثبات إيراده عبر الزمن.',
};
const BILL_FAILURE: Record<string, string> = { PERIOD_STRADDLES_TARIFF_CHANGE: 'فترة الفاتورة تعبر تاريخ تغيير التعرفة: لا تقدير.', NO_TARIFF_ON_RECORD: 'لا تعرفة مسجلة لهذه الفئة والفترة.', INVALID_PERIOD: 'فترة غير صحيحة.' };
const ar = (n: string) => Number(n).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
const monthName = (m: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00+03:00`));
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null;
    throw err;
  }
}

function PolicyForm({ slug, p, branches, note }: { slug: string; p: CostPolicyParams; branches: { id: string; name: string }[]; note: string | null }) {
  return (
    <ActionForm action={saveCostPolicyAction.bind(null, slug, branches.map((b) => b.id))} submitLabel="حفظ المسودة">
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">الكهرباء (تعرفة السعودية للطاقة)</legend>
        <label>فئة التعرفة<select name="tariffCategory" defaultValue={p.electricity.tariffCategory}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>توزيع الكهرباء على القاعات<select name="allocation" defaultValue={p.electricity.allocation}>{Object.entries(ALLOCATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>نسبة ضريبة القيمة المضافة % <input type="number" name="vatRatePercent" min={0} max={100} step="0.01" defaultValue={p.electricity.vatRatePercent} /></label>
        <label className="check"><input type="checkbox" name="vatRegistered" defaultChecked={p.electricity.vatRegistered} /> المعهد مسجَّل في ضريبة القيمة المضافة (التسجيل إلزامي إذا جاوزت توريداته الخاضعة 375,000 ريال خلال 12 شهراً). غير المسجَّل لا يخصم ضريبة المدخلات.</label>
        <label>نسبة الضريبة القابلة للخصم % <span className="hint">100 إذا كانت كل توريداتك خاضعة (التعليم خاضع، وللمواطنين تتحمل الدولة الضريبة)؛ أقل إذا كانت لديك توريدات معفاة (كتأجير سكني)، فتُوزَّع بنسبة الخاضع</span><input type="number" name="vatRecoveryPercent" min={0} max={100} step="0.01" defaultValue={p.electricity.vatRecoveryPercent} /></label>
        {branches.map((b) => (
          <label key={b.id}>سعة القاطع الرئيسي لفرع {b.name} (أمبير) <span className="hint">للرسم الثابت من 2027</span><input type="number" name={`amps_${b.id}`} min={1} max={10000} defaultValue={p.electricity.breakerAmps[b.id] ?? ''} /></label>
        ))}
      </fieldset>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">الإهلاك (المعايير الدولية المعتمدة في المملكة: القسط الثابت)</legend>
        <label>بداية الإهلاك<select name="depStart" defaultValue={p.depreciation.start}><option value="PURCHASE_MONTH">من شهر الشراء</option><option value="NEXT_MONTH">من الشهر التالي للشراء</option></select></label>
        <label>العمر النافع الافتراضي (شهر) <span className="hint">لأصل لم يُحدَّد عمره</span><input type="number" name="defaultLifeMonths" min={1} max={600} defaultValue={p.depreciation.defaultLifeMonths} /></label>
      </fieldset>
      <fieldset className="group" style={{ padding: 10 }}>
        <legend className="small">التحميل والإيراد</legend>
        <label>توزيع المصروفات العامة (غير المرتبطة بقاعة)<select name="overheadBasis" defaultValue={p.overhead.basis}><option value="AREA">بالمساحة</option><option value="HOURS">بساعات التشغيل الفعلية</option></select></label>
        <label>ساعات القاعة المتاحة شهرياً <span className="hint">مقام الإشغال</span><input type="number" name="availableHours" min={1} max={744} defaultValue={p.occupancy.availableHoursPerMonth} /></label>
        <label>أساس إيراد البرنامج<select name="revenueBasis" defaultValue={p.revenue.basis}><option value="OVER_TIME">يُثبَّت عبر الزمن بنسبة الساعات المنفذة (IFRS 15، الموصى به)</option><option value="CASH">المحصَّل في الشهر (رأي إداري، ليس وفق IFRS 15)</option></select></label>
      </fieldset>
      <label>ملاحظة للاعتماد<input name="note" maxLength={500} defaultValue={note ?? ''} /></label>
    </ActionForm>
  );
}

export default async function CostPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ month?: string; branch?: string; saved?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute/cost`)}`);
  const t = session.token;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : shift(thisMonth(), -1);

  let me;
  try {
    me = await getInstituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) redirect(`/${slug}/institute`);
    throw err;
  }
  if (!me.can_read.cost) redirect(`/${slug}/institute`);

  const [branches, rooms, policies, readings] = await Promise.all([
    orNull(admin.instituteBranches(slug, t)),
    orNull(admin.instituteRooms(slug, t)),
    orNull(admin.costPolicies(slug, t)),
    orNull(admin.costReadings(slug, t, month)),
  ]);
  const branchList = branches?.branches ?? [];
  const branchId = sp.branch && branchList.some((b) => b.id === sp.branch) ? sp.branch : branchList[0]?.id;
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const roomName = new Map((rooms?.rooms ?? []).map((r) => [r.id, r.name]));
  const approved = policies?.approved ?? null;
  const draft: CostPolicy | null = policies?.draft ?? null;
  let report = null;
  let reportError: string | null = null;
  if (approved && branchId) {
    try {
      report = await admin.costReport(slug, t, branchId, month);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) reportError = err.message;
      else throw err;
    }
  }
  const w = me.can_write;
  const notice = sp.saved ? NOTICES[sp.saved] : null;
  const link = (m: string, b = branchId) => `/${slug}/institute/cost?month=${m}${b ? `&branch=${b}` : ''}`;
  const formBase: CostPolicyParams = (draft ?? approved)?.params ?? policies?.defaults ?? { electricity: { tariffCategory: 'COMMERCIAL', allocation: 'METER', vatRatePercent: 15, vatRegistered: true, vatRecoveryPercent: 100, breakerAmps: {} }, depreciation: { start: 'PURCHASE_MONTH', defaultLifeMonths: 60 }, overhead: { basis: 'AREA' }, occupancy: { availableHoursPerMonth: 176 }, revenue: { basis: 'OVER_TIME' } };

  return (
    <div className="stack">
      <header className="ix-head">
        <div>
          <h1>التكاليف والربحية</h1>
          <p>تكلفة القاعة والساعة والبرنامج والطالب وربحية البرنامج، بالهللة، وفق سياسة تكلفة معتمدة ومجمّدة بإصدار. لا تُصدر أرقام بلا سياسة معتمدة.</p>
        </div>
        <div className="ix-tools">
          <nav className="ix-seg" aria-label="الشهر">
            <Link href={link(shift(month, -1))}>{monthName(shift(month, -1))}</Link>
            <Link href={link(month)} aria-current="true">{monthName(month)}</Link>
            {month < thisMonth() && <Link href={link(shift(month, 1))}>{monthName(shift(month, 1))}</Link>}
          </nav>
        </div>
      </header>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {branchList.length > 1 && (
        <nav className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label="الفروع">
          {branchList.map((b) => <Link key={b.id} href={link(month, b.id)} className={`btn ${b.id === branchId ? 'btn-primary' : 'btn-ghost'}`}>{b.name}</Link>)}
        </nav>
      )}

      {!approved && <p className="notice" role="status">لا توجد سياسة معتمدة بعد. {w.cost_policy ? 'أنشئ مسودة أدناه، ثم تعتمدها إدارة المعهد.' : 'تُنشئها المالية وتعتمدها إدارة المعهد.'}</p>}
      {reportError && <p className="notice error" role="alert">{reportError}</p>}

      {report && (
        <>
          <section className="card stack" aria-labelledby="rooms-h">
            <h2 id="rooms-h">تكلفة القاعات — {branchName.get(report.branch_id) ?? ''} — {month}</h2>
            <p className="small muted">سياسة معتمدة رقم {report.policy.version}. توزيع الكهرباء: {ALLOCATION[report.electricity.method_used] ?? report.electricity.method_used}. إجمالي كهرباء الشهر المحمَّل: {ar(report.electricity.cost)} ريال.</p>
            <table className="table"><thead><tr><th>القاعة</th><th>كهرباء</th><th>إهلاك</th><th>مصروفات مباشرة</th><th>عامة</th><th>الإجمالي</th><th>ساعات</th><th>تكلفة الساعة</th><th>الإشغال</th></tr></thead>
              <tbody>
                {report.rooms.map((r) => (
                  <tr key={r.room_id}><td>{r.name}</td><td>{ar(r.electricity)}</td><td>{ar(r.depreciation)}</td><td>{ar(r.direct_expenses)}</td><td>{ar(r.overhead)}</td><td><strong>{ar(r.total)}</strong></td><td>{(r.held_minutes / 60).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })}</td><td>{r.cost_per_hour ? ar(r.cost_per_hour) : '—'}</td><td>{r.occupancy_percent.toLocaleString('ar-SA-u-nu-latn')}٪</td></tr>
                ))}
                <tr><th colSpan={5}>الإجمالي</th><th>{ar(report.total_room_cost)}</th><th colSpan={3} /></tr>
              </tbody></table>
            <p className="small muted">السعة المعطّلة (تكلفة قاعات لم تستوعبها حصص منفذة): {ar(report.idle_cost)} ريال.</p>
          </section>

          <section className="card stack" aria-labelledby="prog-h">
            <h2 id="prog-h">تكلفة وربحية البرامج</h2>
            {report.programs.length === 0 ? <p className="muted">لا توجد برامج.</p> : (
              <table className="table"><thead><tr><th>البرنامج</th><th>ساعات منفذة</th><th>تكلفة القاعات</th><th>أجور المدربين</th><th>إجمالي التكلفة</th><th>الإيراد</th><th>الربح</th><th>طلاب</th><th>تكلفة الطالب</th></tr></thead>
                <tbody>{report.programs.map((p) => (
                  <tr key={p.program_id}><td>{p.name}</td><td>{(p.held_minutes / 60).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })}</td><td>{ar(p.facility_cost)}</td><td>{ar(p.instructor_cost)}</td><td>{ar(p.total_cost)}</td><td>{ar(p.revenue)}</td><td style={{ color: Number(p.profit) < 0 ? '#a3341f' : '#1f7a46', fontWeight: 700 }}>{ar(p.profit)}</td><td>{formatNumber(p.active_students)}</td><td>{p.cost_per_student ? ar(p.cost_per_student) : '—'}</td></tr>
                ))}</tbody></table>
            )}
            <p className="small muted">الإيراد حسب السياسة المعتمدة ({approved?.params.revenue.basis === 'OVER_TIME' ? 'يُثبَّت عبر الزمن بنسبة الساعات المنفذة' : 'المحصَّل في الشهر'}) وهو صافي الخصم، ولا يشمل ضريبة القيمة المضافة. الربح هنا قبل المصروفات الإدارية الأخرى.</p>
          </section>

          {report.bill_check && (
            <section className="card stack" aria-labelledby="bill-h">
              <h2 id="bill-h">فحص فاتورة الكهرباء مقابل التعرفة</h2>
              {report.bill_check.estimate ? (
                <>
                  <p>المدفوع <strong>{ar(report.bill_check.actual)}</strong> ريال، والمقدَّر وفق التعرفة <strong>{ar(report.bill_check.estimate.total)}</strong> ريال
                    {report.bill_check.difference !== null && <> (الفرق {ar(report.bill_check.difference)}) — <strong style={{ color: report.bill_check.level === 'OK' ? '#1f7a46' : '#a36a00' }}>{report.bill_check.level === 'OK' ? 'مطابقة' : 'تستحق المراجعة'}</strong></>}</p>
                  <ul className="small" style={{ paddingInlineStart: 18 }}>
                    {report.bill_check.estimate.tiers.map((x, i) => <li key={i}>{formatNumber(x.kwh)} ك.و.س × {x.halalas_per_kwh} هللة = {ar(x.amount)}</li>)}
                    <li>الرسم الثابت: {report.bill_check.estimate.fixed === null ? 'غير مسجل لهذه الفترة أو سعة القاطع غير مدخلة' : ar(report.bill_check.estimate.fixed)}</li>
                    <li>الضريبة: {ar(report.bill_check.estimate.vat)}</li>
                  </ul>
                </>
              ) : <p>{report.bill_check.failure ? BILL_FAILURE[report.bill_check.failure] ?? report.bill_check.failure : report.bill_check.note}</p>}
              <p className="small muted">{report.bill_check.note}. التعرفة من إعلان السعودية للطاقة؛ يُرجع إلى جدول التعرفة الرسمي للتأكد من الأرقام.</p>
            </section>
          )}

          {report.warnings.length > 0 && (
            <section className="card stack" aria-labelledby="warn-h">
              <h2 id="warn-h">تنبيهات جودة البيانات ({formatNumber(report.warnings.length)})</h2>
              <ul className="small" style={{ paddingInlineStart: 18 }}>{report.warnings.map((x, i) => <li key={i}>{WARNING[x.code] ?? x.code}{x.detail && !['overhead'].includes(x.detail) ? <span className="muted" dir="ltr"> {x.detail.slice(0, 8)}</span> : null}</li>)}</ul>
            </section>
          )}
        </>
      )}

      {readings && branchId && (
        <section className="card stack" aria-labelledby="meter-h">
          <h2 id="meter-h">قراءات العدادات الفرعية — {month}</h2>
          {readings.readings.filter((r) => r.branch_id === branchId).length === 0 ? <p className="muted">لا قراءات. تُستعمل عند اختيار التوزيع بالعدادات.</p> : (
            <table className="table"><thead><tr><th>القاعة</th><th>ك.و.س</th>{w.meter && <th />}</tr></thead>
              <tbody>{readings.readings.filter((r) => r.branch_id === branchId).map((r) => (
                <tr key={r.id}><td>{roomName.get(r.room_id) ?? '—'}</td><td>{ar(r.kwh)}</td>{w.meter && <td><ConfirmAction action={deleteReadingAction.bind(null, slug, month, branchId, r.id)} label="حذف" confirmText="حذف هذه القراءة؟" variant="ghost" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.meter && (
            <details>
              <summary>تسجيل قراءة</summary>
              <ActionForm action={saveReadingAction.bind(null, slug)} submitLabel="حفظ القراءة">
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="branch_id" value={branchId} />
                <label>القاعة<select name="room_id" required defaultValue=""><option value="" disabled>اختر القاعة</option>{(rooms?.rooms ?? []).filter((r) => r.branch_id === branchId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label>الاستهلاك (كيلوواط ساعة)<input name="kwh" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {policies && (
        <section className="card stack" aria-labelledby="pol-h">
          <h2 id="pol-h">سياسة التكلفة</h2>
          {approved ? <p>المعتمدة: <strong>الإصدار {approved.version}</strong> — اعتُمدت {approved.approved_at ? new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium' }).format(new Date(approved.approved_at)) : ''}{approved.note ? ` — ${approved.note}` : ''}. لا تُعدَّل بعد الاعتماد؛ التعديل مسودة بإصدار جديد.</p> : <p className="muted">لا توجد سياسة معتمدة.</p>}
          {policies.history.length > 0 && <p className="small muted">إصدارات سابقة محفوظة للمراجعة: {policies.history.map((h) => h.version).join('، ')}.</p>}
          {draft && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="notice" role="status">مسودة الإصدار {draft.version} لم تُعتمد بعد.</span>
              {w.cost_policy_approve && <ConfirmAction action={approveCostPolicyAction.bind(null, slug)} label="اعتماد المسودة" confirmText={`اعتماد الإصدار ${draft.version}؟ يصبح هو الأساس لكل التقارير ولا يُعدَّل بعده.`} />}
              {w.cost_policy && <ConfirmAction action={discardCostDraftAction.bind(null, slug)} label="حذف المسودة" confirmText="حذف المسودة؟" variant="ghost" />}
            </div>
          )}
          {w.cost_policy && (
            <details open={!approved && !draft}>
              <summary>{draft ? 'تعديل المسودة' : 'مسودة جديدة'}</summary>
              <PolicyForm slug={slug} p={formBase} branches={branchList} note={draft?.note ?? null} />
            </details>
          )}
          <p className="small muted">الأساس المحاسبي: المعايير الدولية للتقرير المالي المعتمدة من الهيئة السعودية للمراجعين والمحاسبين (الإهلاك بالقسط الثابت، والإيراد عبر الزمن). أما نسب الإهلاك الضريبي لدى هيئة الزكاة والضريبة والجمارك فحسابها مختلف وغير مُستعمل هنا. ومعاملة ضريبة القيمة المضافة تُقرَّر مع محاسب قانوني.</p>
        </section>
      )}
    </div>
  );
}
