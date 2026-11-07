import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addBillAction,
  addExpenseAction,
  cancelInvoiceAction,
  closeMonthAction,
  deleteBillAction,
  deleteBudgetAction,
  deleteExpenseAction,
  issueInvoiceAction,
  receivePaymentAction,
  recordPayoutAction,
  reopenMonthAction,
  saveBudgetAction,
  voidPaymentAction,
  voidPayoutAction,
} from '@/lib/institute-actions';
import { ApiError, admin, type FinInvoice } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
/** Counts use Latin digits in the institute workspace (readable and tabular, like the amounts). */
const formatNumber = (n: number) => n.toLocaleString('ar-SA-u-nu-latn');
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../../dashboard/health/health-forms';
import { getInstituteMe } from '../ix-data';

export const metadata: Metadata = { title: 'مالية المعهد' };

const NOTICES: Record<string, string> = {
  expense: 'تم تحديث المصروفات.',
  bill: 'تم تحديث فواتير الكهرباء.',
  budget: 'تم تحديث الميزانيات.',
  invoice: 'تم تحديث الفواتير.',
  payment: 'تم تسجيل الدفعة.',
  void: 'تم إبطال الدفعة (تبقى في السجل).',
  closed: 'تم إغلاق الشهر.',
  reopened: 'أُعيد فتح الشهر.',
};
const LEVEL: Record<string, { label: string; color: string }> = {
  OK: { label: 'ضمن الميزانية', color: '#1f7a46' },
  WARNING: { label: 'اقترب من الحد', color: '#a36a00' },
  EXCEEDED: { label: 'تجاوز الميزانية', color: '#a3341f' },
};
const STATE: Record<string, string> = { PAID: 'مسدد', PARTIAL: 'جزئي', OVERDUE: 'متأخر', UPCOMING: 'قادم' };
const METHOD: Record<string, string> = { CASH: 'نقداً', TRANSFER: 'تحويل', CARD: 'بطاقة', OTHER: 'أخرى' };
const PAYOUT_METHOD: Record<string, string> = { TRANSFER: 'تحويل', CASH: 'نقداً', CHEQUE: 'شيك', OTHER: 'أخرى' };
const VAT_LABEL: Record<string, string> = { NONE: 'بلا ضريبة', STANDARD: 'ضريبة بالنسبة الأساسية', STATE_BORNE: 'مواطن: تتحمل الدولة الضريبة' };
const ar = (n: string) => Number(n).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Saudi-time current month, YYYY-MM. */
const thisMonth = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
const monthName = (m: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00+03:00`));
/** In the first ten days of a month its figures are barely formed: open the month that just ended. */
const defaultMonth = () => {
  const now = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const m = now.slice(0, 7);
  if (Number(now.slice(8, 10)) > 10) return m;
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
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

export default async function FinancePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ month?: string; saved?: string; inv?: string; ip?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute/finance`)}`);
  const t = session.token;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : defaultMonth();
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

  let me;
  try {
    me = await getInstituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) redirect(`/${slug}/institute`);
    throw err;
  }
  if (!me.can_read.finance) redirect(`/${slug}/institute`);

  const [branches, students, summary, budgets, expenses, bills, invoices, dues, vat, closed, rooms] = await Promise.all([
    orNull(admin.instituteBranches(slug, t)),
    orNull(admin.instituteStudents(slug, t)),
    orNull(admin.finSummary(slug, t, month)),
    orNull(admin.finBudgets(slug, t, month)),
    orNull(admin.finExpenses(slug, t, `${month}-01`, lastDay(month))),
    orNull(admin.finBills(slug, t)),
    orNull(admin.finInvoices(slug, t)),
    orNull(admin.finDues(slug, t, month)),
    orNull(admin.finVat(slug, t, month)),
    orNull(admin.finClosed(slug, t)),
    orNull(admin.instituteRooms(slug, t)),
  ]);
  const w = me.can_write;
  const branchList = branches?.branches ?? [];
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const studentList = students?.students ?? [];
  const studentName = new Map(studentList.map((s) => [s.id, s.full_name]));
  const roomList = rooms?.rooms ?? [];
  const closedHere = new Map((closed?.closed ?? []).filter((c) => c.period === `${month}-01`).map((c) => [c.branch_id, c]));
  const notice = sp.saved ? NOTICES[sp.saved] : null;
  const only = branchList.length === 1 ? branchList[0]?.id : '';
  const monthEnded = shift(month, 1) <= today.slice(0, 7);
  const BranchSelect = ({ name }: { name: string }) => (
    <select name={name} required defaultValue={only}>
      <option value="" disabled>اختر الفرع</option>
      {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
  const Month = () => <input type="hidden" name="month" value={month} />;
  const openInvoices = (invoices?.invoices ?? []).filter((i) => i.status === 'OPEN');
  const overdue = openInvoices.filter((i) => i.overdue);

  return (
    <div className="stack">
      <header className="ix-head">
        <div>
          <h1>مالية المعهد</h1>
          <p>المصروفات وفواتير الكهرباء والميزانيات وفواتير الطلاب ومدفوعاتهم. الأرقام بالريال وبدقة الهللة، وما بعد إغلاق الشهر لا يتغير.</p>
        </div>
        <nav className="ix-seg" aria-label="الشهر">
          <Link href={`/${slug}/institute/finance?month=${shift(month, -1)}`}>{monthName(shift(month, -1))}</Link>
          <Link href={`/${slug}/institute/finance?month=${month}`} aria-current="true">{monthName(month)}</Link>
          {month < thisMonth() && <Link href={`/${slug}/institute/finance?month=${shift(month, 1)}`}>{monthName(shift(month, 1))}</Link>}
        </nav>
      </header>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {summary && (
        <section className="card stack" aria-labelledby="sum-h">
          <h2 id="sum-h">ملخص الشهر</h2>
          <table className="table"><thead><tr><th>الفرع</th><th>الإيراد المحصَّل</th><th>المصروفات والكهرباء</th><th>الصافي</th><th>الحالة</th></tr></thead>
            <tbody>
              {summary.branches.map((b) => (
                <tr key={b.branch_id}><td>{branchName.get(b.branch_id) ?? '—'}</td><td>{ar(b.income)}</td><td>{ar(b.spend)}</td><td style={{ color: Number(b.net) < 0 ? '#a3341f' : undefined }}>{ar(b.net)}</td><td><span className={`ix-chip ${closedHere.has(b.branch_id) || b.closed ? 'mute' : 'ok'}`}>{closedHere.has(b.branch_id) || b.closed ? 'مغلق' : 'مفتوح'}</span></td></tr>
              ))}
              <tr><th>الإجمالي</th><th>{ar(summary.totals.income)}</th><th>{ar(summary.totals.spend)}</th><th>{ar(summary.totals.net)}</th><th /></tr>
            </tbody></table>
          {overdue.length > 0 && <p className="notice" role="status">فواتير بها أقساط متأخرة: {formatNumber(overdue.length)}، والمتبقي عليها {ar(String(overdue.reduce((n, i) => n + Number(i.outstanding), 0)))} ريال.</p>}
          {w.ledger_admin && branchList.length > 0 && monthEnded && (
            <details>
              <summary>إغلاق الشهر</summary>
              <ActionForm action={closeMonthAction.bind(null, slug)} submitLabel="إغلاق الشهر لهذا الفرع">
                <Month />
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <p className="small muted">بعد الإغلاق لا يمكن إضافة أو تعديل أو حذف أي مصروف أو فاتورة كهرباء أو دفعة تاريخها في هذا الشهر. يمكن لإدارة المعهد أو المالية إعادة فتحه.</p>
              </ActionForm>
            </details>
          )}
          {w.ledger_admin && (closed?.closed ?? []).filter((c) => c.period === `${month}-01`).map((c) => (
            <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span>شهر {month} مغلق لفرع {branchName.get(c.branch_id) ?? ''}</span>
              <ConfirmAction action={reopenMonthAction.bind(null, slug, month, c.id)} label="إعادة الفتح" confirmText="إعادة فتح هذا الشهر للتعديل؟" variant="ghost" />
            </div>
          ))}
        </section>
      )}

      {budgets && (
        <section className="card stack" aria-labelledby="bud-h">
          <h2 id="bud-h">الميزانيات والتنبيهات ({formatNumber(budgets.budgets.length)})</h2>
          {budgets.budgets.length === 0 ? <p className="muted">لا توجد ميزانيات لهذا الشهر.</p> : (
            <table className="table"><thead><tr><th>الفرع</th><th>البند</th><th>الميزانية</th><th>المصروف</th><th>المتبقي</th><th>النسبة</th><th>الحالة</th>{w.budget && <th />}</tr></thead>
              <tbody>{budgets.budgets.map((b) => (
                <tr key={b.id}><td>{branchName.get(b.branch_id) ?? '—'}</td><td>{b.category === 'ELECTRICITY' ? 'الكهرباء' : b.category === 'INSTRUCTOR_PAY' ? 'أجور المدربين' : b.category ?? 'الإجمالي'}</td><td>{ar(b.amount)}</td><td>{ar(b.spent)}</td><td>{ar(b.remaining)}</td><td>{b.percent === null ? '—' : `${b.percent}%`}</td>
                  <td><span className={`ix-chip ${b.level === 'EXCEEDED' ? 'bad' : b.level === 'WARNING' ? 'warn' : 'ok'}`}>{LEVEL[b.level]?.label}</span></td>
                  {w.budget && <td><ConfirmAction action={deleteBudgetAction.bind(null, slug, month, b.id)} label="حذف" confirmText="حذف هذه الميزانية؟" variant="ghost" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.budget && (
            <details>
              <summary>تحديد ميزانية</summary>
              <ActionForm action={saveBudgetAction.bind(null, slug)} submitLabel="حفظ الميزانية">
                <Month />
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>البند <span className="hint">(اتركه فارغاً لميزانية الفرع الإجمالية؛ اكتب ELECTRICITY لفواتير الكهرباء)</span><input name="category" maxLength={80} /></label>
                <label>المبلغ (ريال)<input name="amount" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>تنبيه عند % <span className="hint">(الافتراضي 80)</span><input type="number" name="warn_percent" min={1} max={100} defaultValue={80} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {expenses && (
        <section className="card stack" aria-labelledby="exp-h">
          <h2 id="exp-h">المصروفات التشغيلية ({formatNumber(expenses.expenses.length)})</h2>
          {expenses.expenses.length === 0 ? <p className="muted">لا توجد مصروفات في هذا الشهر.</p> : (
            <table className="table"><thead><tr><th>التاريخ</th><th>الفرع</th><th>البند</th><th>المبلغ</th><th>المورّد</th>{w.expense && <th />}</tr></thead>
              <tbody>{expenses.expenses.map((e) => (
                <tr key={e.id}><td dir="ltr">{e.incurred_on}</td><td>{branchName.get(e.branch_id) ?? '—'}</td><td>{e.category}{e.description ? <span className="muted"> · {e.description}</span> : null}</td><td>{ar(e.amount)}</td><td>{e.vendor ?? '—'}</td>
                  {w.expense && <td><ConfirmAction action={deleteExpenseAction.bind(null, slug, month, e.id)} label="حذف" confirmText="حذف هذا المصروف؟" variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.expense && (
            <details>
              <summary>تسجيل مصروف</summary>
              <ActionForm action={addExpenseAction.bind(null, slug)} submitLabel="تسجيل المصروف">
                <Month />
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>البند <span className="hint">(ورقيات، صيانة مكيفات، أمن، نظافة...)</span><input name="category" required maxLength={80} /></label>
                <label>المبلغ (ريال)<input name="amount" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>التاريخ<input type="date" name="incurred_on" required defaultValue={`${month}-01`} /></label>
                <label>القاعة <span className="hint">(اختياري، من الفرع نفسه)</span><select name="room_id" defaultValue=""><option value="">بلا قاعة</option>{roomList.map((r) => <option key={r.id} value={r.id}>{branchName.get(r.branch_id)} — {r.name}</option>)}</select></label>
                <label>المورّد<input name="vendor" maxLength={120} /></label>
                <label>ملاحظات<input name="description" maxLength={500} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {bills && (
        <section className="card stack" aria-labelledby="bill-h">
          <h2 id="bill-h">فواتير الكهرباء ({formatNumber(bills.bills.length)})</h2>
          {bills.bills.length === 0 ? <p className="muted">لا توجد فواتير كهرباء مسجلة.</p> : (
            <table className="table"><thead><tr><th>الفرع</th><th>الفترة</th><th>المبلغ</th><th>الاستهلاك (ك.و.س)</th>{w.expense && <th />}</tr></thead>
              <tbody>{bills.bills.slice(0, 24).map((b) => (
                <tr key={b.id}><td>{branchName.get(b.branch_id) ?? '—'}</td><td dir="ltr">{b.period_start} → {b.period_end}</td><td>{ar(b.amount)}</td><td>{b.kwh ? ar(b.kwh) : '—'}</td>
                  {w.expense && <td><ConfirmAction action={deleteBillAction.bind(null, slug, month, b.id)} label="حذف" confirmText="حذف فاتورة الكهرباء؟" variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.expense && (
            <details>
              <summary>تسجيل فاتورة كهرباء</summary>
              <ActionForm action={addBillAction.bind(null, slug)} submitLabel="تسجيل الفاتورة">
                <Month />
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>من<input type="date" name="period_start" required defaultValue={`${month}-01`} /></label>
                <label>إلى<input type="date" name="period_end" required defaultValue={lastDay(month)} /></label>
                <label>المبلغ (ريال)<input name="amount" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>الاستهلاك بالكيلوواط ساعة <span className="hint">(اختياري، لفحص الفاتورة مقابل التعرفة)</span><input name="kwh" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>الضريبة المذكورة في الفاتورة (ريال) <span className="hint">(اختياري، مشمولة في المبلغ)</span><input name="vat_amount" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {invoices && (() => {
        const all = invoices.invoices;
        const kindOf = (i: FinInvoice) => (i.status === 'CANCELLED' ? 'cancelled' : Number(i.outstanding) === 0 ? 'paid' : i.overdue ? 'overdue' : 'open');
        const FILTERS: [string, string][] = [['all', 'الكل'], ['overdue', 'متأخرة'], ['open', 'مفتوحة'], ['paid', 'مسددة'], ['cancelled', 'ملغاة']];
        const count = (k: string) => (k === 'all' ? all.length : all.filter((i) => kindOf(i) === k).length);
        const f = FILTERS.some(([k]) => k === sp.inv) ? (sp.inv as string) : 'all';
        const rank = { overdue: 0, open: 1, paid: 2, cancelled: 3 } as const;
        const list = (f === 'all' ? [...all] : all.filter((i) => kindOf(i) === f)).sort((a, b) => rank[kindOf(a)] - rank[kindOf(b)]);
        const PAGE = 12;
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        const pg = Math.min(pages, Math.max(1, Number(sp.ip) || 1));
        const shown = list.slice((pg - 1) * PAGE, pg * PAGE);
        const href = (extra: { inv?: string; ip?: number }) => {
          const u = new URLSearchParams({ month });
          const inv = 'inv' in extra ? extra.inv : f;
          if (inv && inv !== 'all') u.set('inv', inv);
          if (extra.ip && extra.ip > 1) u.set('ip', String(extra.ip));
          return `/${slug}/institute/finance?${u.toString()}#invoices`;
        };
        const CHIP: Record<string, [string, string]> = { overdue: ['bad', 'متأخرة'], open: ['', 'مفتوحة'], paid: ['ok', 'مسددة'], cancelled: ['mute', 'ملغاة'] };
        return (
          <section className="card stack" aria-labelledby="inv-h" id="invoices">
            <div className="ix-head">
              <h2 id="inv-h">فواتير الطلاب</h2>
              <nav className="ix-seg" aria-label="حالة الفاتورة">
                {FILTERS.map(([k, label]) => <Link key={k} href={href({ inv: k })} aria-current={f === k ? 'true' : undefined}>{label} <span className="muted">{formatNumber(count(k))}</span></Link>)}
              </nav>
            </div>
            {list.length === 0 ? <p className="muted">لا توجد فواتير في هذه الحالة.</p> : (
              <div className="ix-inv-list">
                {shown.map((i) => {
                  const kind = kindOf(i);
                  const [tone, word] = CHIP[kind] as [string, string];
                  return (
                    <details key={i.id} className="ix-inv">
                      <summary>
                        <span className="ix-inv-main"><b>{studentName.get(i.student_id) ?? 'طالب'}</b><small>{i.description} · {branchName.get(i.branch_id) ?? ''}</small></span>
                        <span className="ix-inv-num"><small>الإجمالي</small>{ar(i.total)}</span>
                        <span className="ix-inv-num"><small>المدفوع</small>{ar(i.paid)}</span>
                        <span className="ix-inv-num"><small>المتبقي</small><b>{ar(i.outstanding)}</b></span>
                        <span className={`ix-chip ${tone}`}>{word}</span>
                      </summary>
                      <div className="ix-inv-body">
                        <p className="small muted">
                          صافي {ar(i.net)}{i.vat_treatment === 'STANDARD' ? ` + ضريبة ${i.vat_rate_percent}٪ (${ar(i.vat)}) = ${ar(i.total)}` : ''}. {VAT_LABEL[i.vat_treatment]}{i.vat_treatment === 'STATE_BORNE' ? ` (هوية المستفيد ••••${i.beneficiary_id_last4 ?? ''})، ولا تُحمَّل ضريبة على الطالب` : ''}.
                        </p>
                        <table className="table">
                          <thead><tr><th>القسط</th><th>الاستحقاق</th><th>المبلغ</th><th>المسدد</th><th>الحالة</th></tr></thead>
                          <tbody>
                            {i.installments.map((x, n) => <tr key={n}><td>{formatNumber(n + 1)}</td><td dir="ltr">{x.due_on}</td><td>{ar(x.amount)}</td><td>{ar(x.paid)}</td><td><span className={`ix-chip ${x.state === 'PAID' ? 'ok' : x.state === 'OVERDUE' ? 'bad' : x.state === 'PARTIAL' ? 'warn' : 'mute'}`}>{STATE[x.state]}</span></td></tr>)}
                          </tbody>
                        </table>
                        {i.payments.length > 0 && (
                          <ul className="small" style={{ paddingInlineStart: 18, margin: 0 }}>
                            {i.payments.map((p) => (
                              <li key={p.id} style={p.voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                                <span dir="ltr">{p.paid_on}</span> — {ar(p.amount)} — {METHOD[p.method]}{p.reference ? ` (${p.reference})` : ''}{p.voided ? ` — مُبطلة: ${p.void_reason ?? ''}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="ix-inv-actions">
                          {w.invoice && i.status === 'OPEN' && Number(i.outstanding) > 0 && (
                            <details>
                              <summary>تسجيل دفعة</summary>
                              <ActionForm action={receivePaymentAction.bind(null, slug)} submitLabel="تسجيل الدفعة">
                      <Month />
                      <input type="hidden" name="invoice_id" value={i.id} />
                      <label>المبلغ (ريال)<input name="amount" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" defaultValue={i.outstanding} /></label>
                      <label>التاريخ<input type="date" name="paid_on" required defaultValue={today} max={today} /></label>
                      <label>الطريقة<select name="method" defaultValue="CASH">{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label>المرجع<input name="reference" maxLength={120} dir="ltr" /></label>
                    </ActionForm>
                            </details>
                          )}
                          {w.ledger_admin && i.payments.some((p) => !p.voided) && (
                            <details>
                              <summary>إبطال دفعة</summary>
                              <ActionForm action={voidPaymentAction.bind(null, slug, month)} submitLabel="إبطال الدفعة">
                      <label>الدفعة<select name="payment_id" required defaultValue="">
                        <option value="" disabled>اختر الدفعة</option>
                        {i.payments.filter((p) => !p.voided).map((p) => <option key={p.id} value={p.id}>{p.paid_on} — {ar(p.amount)}</option>)}</select></label>
                      <label>السبب (مطلوب)<input name="reason" required minLength={3} maxLength={300} /></label>
                    </ActionForm>
                            </details>
                          )}
                          {w.ledger_admin && i.status === 'OPEN' && <ConfirmAction action={cancelInvoiceAction.bind(null, slug, month, i.id)} label="إلغاء الفاتورة" confirmText="إلغاء هذه الفاتورة؟ لا تُلغى وعليها دفعات فعّالة." variant="ghost" />}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
            {pages > 1 && (
              <nav className="ix-pager" aria-label="صفحات الفواتير">
                {pg > 1 && <Link href={href({ ip: pg - 1 })} className="btn btn-ghost">السابقة</Link>}
                <span className="small muted">صفحة {formatNumber(pg)} من {formatNumber(pages)}</span>
                {pg < pages && <Link href={href({ ip: pg + 1 })} className="btn btn-ghost">التالية</Link>}
              </nav>
            )}
          {w.invoice && studentList.length > 0 && (
            <details>
              <summary>إصدار فاتورة لطالب</summary>
              <ActionForm action={issueInvoiceAction.bind(null, slug)} submitLabel="إصدار الفاتورة">
                <Month />
                <label>الطالب<select name="student_id" required defaultValue=""><option value="" disabled>اختر الطالب</option>{studentList.map((s) => <option key={s.id} value={s.id}>{branchName.get(s.branch_id)} — {s.full_name}</option>)}</select></label>
                <label>الوصف<input name="description" required maxLength={200} defaultValue="رسوم الدبلوم" /></label>
                <label>المبلغ (ريال)<input name="amount" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>الخصم (ريال)<input name="discount" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" defaultValue="0" /></label>
                <label>تاريخ الإصدار<input type="date" name="issued_on" required defaultValue={today} /></label>
                <label>عدد الأقساط الشهرية<input type="number" name="count" min={1} max={60} defaultValue={1} /></label>
                <label>تاريخ أول قسط <span className="hint">(افتراضياً تاريخ الإصدار)</span><input type="date" name="first_due" /></label>
                <p className="small muted">تُقسَّم الفاتورة (بعد الخصم ومع الضريبة إن وُجدت) إلى أقساط شهرية متساوية؛ فرق الهللات في آخر قسط. تُحدَّد الضريبة عند الإصدار وتُجمَّد على الفاتورة: لا ضريبة إن لم يكن للأكاديمية رقم ضريبي في إعداداتها؛ وبالنسبة الأساسية 15٪ لغير السعودي ولغير البرنامج المشمول؛ ولا تُحمَّل على المواطن في برنامج مشمول بتحمّل الدولة (يلزم رقم هويته).</p>
              </ActionForm>
            </details>
          )}
          </section>
        );
      })()}

      {vat && vat.rows.length > 0 && (
        <section className="card stack" aria-labelledby="vat-h">
          <h2 id="vat-h">ضريبة القيمة المضافة على فواتير {month}</h2>
          <table className="table"><thead><tr><th>الفرع</th><th>المعاملة</th><th>الفواتير</th><th>الصافي بعد الخصم</th><th>الضريبة المحمَّلة</th></tr></thead>
            <tbody>{vat.rows.map((r, n) => <tr key={n}><td>{branchName.get(r.branch_id) ?? '—'}</td><td>{VAT_LABEL[r.treatment]}</td><td>{formatNumber(r.invoices)}</td><td>{ar(r.net_amount)}</td><td>{ar(r.vat_amount)}</td></tr>)}</tbody></table>
          <p className="small muted">معلومات لإعداد الإقرار الضريبي (تُحسب حسب تاريخ إصدار الفاتورة، وتستثني الملغاة)، وليست الإقرار نفسه. توريدات المواطنين المشمولة تُبلَّغ في خانة «المبيعات للمواطنين».</p>
        </section>
      )}

      {dues && (
        <section className="card stack" aria-labelledby="dues-h">
          <h2 id="dues-h">مستحقات المدربين عن {month}</h2>
          <p className="small muted">تُحتسب من الحصص التي سُجّلت «تمّت» فقط (الملغاة والمجدولة لا تُحتسب)، بساعات الحصة الفعلية وبأجر ساعة المدرب، وحدود الشهر بتوقيت السعودية. يُصرف عن شهر انتهى فقط.</p>
          {dues.instructors.length === 0 ? <p className="muted">لا توجد حصص منفذة في هذا الشهر.</p> : (
            <table className="table"><thead><tr><th>المدرب</th><th>الفرع</th><th>الساعات</th><th>أجر الساعة</th><th>المستحق</th><th>المصروف</th><th>المتبقي</th></tr></thead>
              <tbody>
                {dues.instructors.map((d) => <tr key={d.instructor_id}><td>{d.name}</td><td>{branchName.get(d.branch_id) ?? '—'}</td><td>{(d.minutes / 60).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })}</td><td>{ar(d.hourly_rate)}</td><td>{ar(d.pay)}</td><td>{ar(d.paid)}</td><td style={{ color: Number(d.outstanding) > 0 ? '#a36a00' : '#1f7a46', fontWeight: 700 }}>{ar(d.outstanding)}</td></tr>)}
                <tr><th colSpan={4}>الإجمالي</th><th>{ar(dues.total)}</th><th>{ar(dues.paid)}</th><th>{ar(dues.outstanding)}</th></tr>
              </tbody></table>
          )}
          {dues.payouts.length > 0 && (
            <ul className="small" style={{ paddingInlineStart: 18 }}>
              {dues.payouts.map((p) => (
                <li key={p.id} style={p.voided ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                  {dues.instructors.find((x) => x.instructor_id === p.instructor_id)?.name ?? 'مدرب'} — <span dir="ltr">{p.paid_on}</span> — {ar(p.amount)} — {PAYOUT_METHOD[p.method]}{p.reference ? ` (${p.reference})` : ''}{p.voided ? ` — مُبطل: ${p.void_reason ?? ''}` : ''}
                </li>
              ))}
            </ul>
          )}
          {w.dues && dues.instructors.some((d) => Number(d.outstanding) > 0) && monthEnded && (
            <details>
              <summary>تسجيل صرف مستحقات مدرب</summary>
              <ActionForm action={recordPayoutAction.bind(null, slug)} submitLabel="تسجيل الصرف">
                <Month />
                <label>المدرب<select name="instructor_id" required defaultValue=""><option value="" disabled>اختر المدرب</option>{dues.instructors.filter((d) => Number(d.outstanding) > 0).map((d) => <option key={d.instructor_id} value={d.instructor_id}>{d.name} — المتبقي {ar(d.outstanding)}</option>)}</select></label>
                <label>المبلغ (ريال) <span className="hint">(اتركه فارغاً لصرف كامل المتبقي؛ لا يزيد عن المتبقي)</span><input name="amount" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                <label>التاريخ<input type="date" name="paid_on" required defaultValue={today} max={today} /></label>
                <label>الطريقة<select name="method" defaultValue="TRANSFER">{Object.entries(PAYOUT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>المرجع<input name="reference" maxLength={120} dir="ltr" /></label>
              </ActionForm>
            </details>
          )}
          {w.ledger_admin && dues.payouts.some((p) => !p.voided) && (
            <details>
              <summary>إبطال صرف</summary>
              <ActionForm action={voidPayoutAction.bind(null, slug, month)} submitLabel="إبطال الصرف">
                <label>الصرف<select name="payout_id" required defaultValue=""><option value="" disabled>اختر الصرف</option>{dues.payouts.filter((p) => !p.voided).map((p) => <option key={p.id} value={p.id}>{dues.instructors.find((x) => x.instructor_id === p.instructor_id)?.name ?? 'مدرب'} — {p.paid_on} — {ar(p.amount)}</option>)}</select></label>
                <label>السبب (مطلوب)<input name="reason" required minLength={3} maxLength={300} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
