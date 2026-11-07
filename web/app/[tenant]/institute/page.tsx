import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, admin, type CostReport, type FinBudget, type FinSummary, type InstSession } from '@/lib/api';
import { isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { BranchBars, DayLegend, DayMap, Sparkline, type DayRoom, type DaySession } from './ix-charts';
import { getInstituteMe } from './ix-data';

export const metadata: Metadata = { title: 'لوحة اليوم' };

const ar = (n: number, digits = 0) => n.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const KIND: Record<string, string> = { CLASSROOM: 'فصل', LAB: 'معمل', HALL: 'قاعة كبرى' };
const dayLong = (d: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'full' }).format(new Date(`${d}T12:00:00+03:00`));
const monthLong = (m: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00+03:00`));
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const t = y * 12 + (mo - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const shiftDay = (d: string, by: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);
const riyadhNow = () => new Date(Date.now() + 3 * 3_600_000);

/** Anything the person's role may not read, or a hiccup in one panel, leaves that panel out instead of failing the page. */
async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function InstituteOverview({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ branch?: string; day?: string; m?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute`)}`);
  const t = session.token;

  let me;
  try {
    me = await getInstituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) {
      return (
        <div className="stack">
          <h1>إدارة المعهد</h1>
          <p className="notice" role="status">{err.code === 'FEATURE_DISABLED' ? 'هذه الوحدة غير مفعّلة لأكاديميتك. تواصل مع إدارة المنصة لتفعيلها.' : 'ليس لديك دور في إدارة المعهد. اطلب من إدارة الأكاديمية إضافتك.'}</p>
        </div>
      );
    }
    throw err;
  }

  const now = riyadhNow();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const canMoney = me.can_read.finance;

  // The month in focus: the one asked for, else this month; but in the first ten days of a month its figures are barely formed, so the
  // month that just ended is shown instead (if it saw activity), with a note and a way back.
  const requested = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : undefined;
  const hasActivity = (s: FinSummary | null) => (s ? s.branches.some((b) => Number(b.income) > 0 || Number(b.spend) > 0) : false);
  const monthsEnding = (end: string, count: number) => Array.from({ length: count }, (_, i) => shiftMonth(end, i - (count - 1)));
  let month = requested ?? currentMonth;
  let series: (FinSummary | null)[] = [];
  let autoPicked = false;
  if (canMoney) {
    if (requested) series = await Promise.all(monthsEnding(requested, 6).map((m) => safe(admin.finSummary(slug, t, m))));
    else {
      const seven = await Promise.all(monthsEnding(currentMonth, 7).map((m) => safe(admin.finSummary(slug, t, m))));
      if (Number(today.slice(8, 10)) <= 10 && hasActivity(seven[5] ?? null)) {
        month = shiftMonth(currentMonth, -1);
        series = seven.slice(0, 6);
        autoPicked = true;
      } else series = seven.slice(1);
    }
  }
  const prevMonth = shiftMonth(month, -1);
  const monthStartIso = `${month}-01T00:00:00+03:00`;
  const monthEndIso = `${shiftMonth(month, 1)}-01T00:00:00+03:00`;

  const [branchesR, roomsR, programsR, instructorsR, studentsR, attentionR, policiesR, monthSessionsR, upcomingR] = await Promise.all([
    safe(admin.instituteBranches(slug, t)),
    safe(admin.instituteRooms(slug, t)),
    safe(admin.institutePrograms(slug, t)),
    safe(admin.instituteInstructors(slug, t)),
    safe(admin.instituteStudents(slug, t)),
    safe(admin.instituteAttention(slug, t)),
    safe(admin.costPolicies(slug, t)),
    safe(admin.instituteSessions(slug, t, new Date(monthStartIso).toISOString(), new Date(monthEndIso).toISOString())),
    safe(admin.instituteSessions(slug, t, new Date(`${today}T00:00:00+03:00`).toISOString(), new Date(`${shiftDay(today, 15)}T00:00:00+03:00`).toISOString())),
  ]);
  const branches = branchesR?.branches ?? [];
  const branch = sp.branch && branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const inBranch = (id: string) => !branch || id === branch;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  // money: six months of summaries (oldest first) for the trend lines, plus invoices and budgets
  const summaries = series;
  const [invoicesR, budgetsR, duesR] = canMoney ? await Promise.all([safe(admin.finInvoices(slug, t)), safe(admin.finBudgets(slug, t, month)), safe(admin.finDues(slug, t, prevMonth))]) : [null, null, null];
  const pick = (s: FinSummary | null, key: 'income' | 'spend') => (s ? s.branches.filter((b) => inBranch(b.branch_id)).reduce((n, b) => n + Number(b[key]), 0) : 0);
  const income = summaries.map((s) => pick(s, 'income'));
  const spend = summaries.map((s) => pick(s, 'spend'));
  const net = income.map((v, i) => v - (spend[i] ?? 0));

  // rooms, sessions, occupancy
  const rooms = (roomsR?.rooms ?? []).filter((r) => r.active && inBranch(r.branch_id));
  const roomIds = new Set(rooms.map((r) => r.id));
  const monthSessions = (monthSessionsR?.sessions ?? []).filter((s) => roomIds.has(s.room_id));
  const heldMinutes = monthSessions.filter((s) => s.status === 'HELD').reduce((n, s) => n + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60_000, 0);
  const availableHours = policiesR?.approved?.params.occupancy.availableHoursPerMonth ?? 176;
  const occupancy = rooms.length > 0 ? Math.min(100, (heldMinutes / 60 / (rooms.length * availableHours)) * 100) : 0;
  const students = (studentsR?.students ?? []).filter((s) => inBranch(s.branch_id));
  const activeStudents = students.filter((s) => s.status === 'ACTIVE').length;

  // the day map: the requested day, else today, else the next day that has a session
  const upcoming = (upcomingR?.sessions ?? []).filter((s) => roomIds.has(s.room_id));
  const dayOf = (s: InstSession) => new Date(new Date(s.starts_at).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const firstBusy = [...upcoming].map(dayOf).sort()[0];
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : upcoming.some((s) => dayOf(s) === today) ? today : firstBusy ?? today;
  const daySessionsRaw = day === today || upcoming.some((s) => dayOf(s) === day) ? upcoming.filter((s) => dayOf(s) === day) : [];
  const dayData = daySessionsRaw.length > 0 || (day >= today && day <= shiftDay(today, 14))
    ? daySessionsRaw
    : ((await safe(admin.instituteSessions(slug, t, new Date(`${day}T00:00:00+03:00`).toISOString(), new Date(`${shiftDay(day, 1)}T00:00:00+03:00`).toISOString())))?.sessions ?? []).filter((s) => roomIds.has(s.room_id));
  const subjectLabel = new Map((programsR?.programs ?? []).flatMap((p) => p.levels.flatMap((l) => l.subjects.map((s) => [s.id, s.name] as const))));
  const instructorName = new Map((instructorsR?.instructors ?? []).map((i) => [i.id, i.full_name]));
  const dayRooms: DayRoom[] = rooms.map((r) => ({ id: r.id, name: r.name, detail: `${branches.length > 1 && !branch ? `${branchName.get(r.branch_id) ?? ''} · ` : ''}${KIND[r.kind]} · ${ar(r.capacity)} مقعد` }));
  const daySessions: DaySession[] = dayData.map((s) => ({
    id: s.id, roomId: s.room_id, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status,
    title: subjectLabel.get(s.subject_id) ?? 'حصة', who: instructorName.get(s.instructor_id) ?? '', href: `/${slug}/institute/session/${s.id}`,
  }));
  const nowHour = day === today ? now.getUTCHours() + now.getUTCMinutes() / 60 : null;

  // what needs a person's attention
  const invoices = (invoicesR?.invoices ?? []).filter((i) => inBranch(i.branch_id));
  const overdue = invoices.filter((i) => i.status === 'OPEN' && i.overdue);
  const overdueSum = overdue.reduce((n, i) => n + Number(i.outstanding), 0);
  const budgets: FinBudget[] = (budgetsR?.budgets ?? []).filter((b) => inBranch(b.branch_id));
  const exceeded = budgets.filter((b) => b.level === 'EXCEEDED');
  const warned = budgets.filter((b) => b.level === 'WARNING');
  const duesOutstanding = duesR ? Number(duesR.outstanding) : 0;
  const attentionCount = attentionR?.items.length ?? 0;
  const billReports: (CostReport | null)[] =
    canMoney && me.can_read.cost && policiesR?.approved ? await Promise.all(branches.filter((b) => inBranch(b.id)).map((b) => safe(admin.costReport(slug, t, b.id, month === currentMonth ? prevMonth : month)))) : [];
  const billsToReview = billReports.filter((r) => r?.bill_check?.level === 'REVIEW');

  // first three, then a count: a long run of budgets is read as "many", not as a paragraph
  const listBudgets = (bs: FinBudget[]) => {
    const line = (b: FinBudget) => `${branchName.get(b.branch_id) ?? ''}: ${b.category === 'ELECTRICITY' ? 'الكهرباء' : b.category ?? 'الإجمالي'} ${ar(b.percent ?? 0)}٪`;
    return bs.slice(0, 3).map(line).join('، ') + (bs.length > 3 ? `، و${ar(bs.length - 3)} أخرى` : '');
  };
  type Todo = { tone: 'bad' | 'warn' | 'ok'; title: string; note: string; href: string; action: string };
  const todos: Todo[] = [];
  if (overdue.length > 0) todos.push({ tone: 'bad', title: `${ar(overdue.length)} فاتورة طالب فيها أقساط متأخرة`, note: `المتبقي عليها ${ar(overdueSum)} ريال`, href: `/${slug}/institute/finance?month=${month}`, action: 'متابعة التحصيل' });
  if (exceeded.length > 0) todos.push({ tone: 'bad', title: `${ar(exceeded.length)} ${exceeded.length === 1 ? 'ميزانية تجاوزت حدّها' : 'ميزانيات تجاوزت حدّها'} هذا الشهر`, note: listBudgets(exceeded), href: `/${slug}/institute/finance?month=${month}`, action: 'مراجعة الميزانيات' });
  if (warned.length > 0) todos.push({ tone: 'warn', title: `${ar(warned.length)} ${warned.length === 1 ? 'ميزانية اقتربت من حدّها' : 'ميزانيات اقتربت من حدّها'}`, note: listBudgets(warned), href: `/${slug}/institute/finance?month=${month}`, action: 'عرض' });
  if (duesOutstanding > 0) todos.push({ tone: 'warn', title: `مستحقات مدربين غير مصروفة عن ${monthLong(prevMonth)}`, note: `${ar(duesOutstanding)} ريال متبقية`, href: `/${slug}/institute/finance?month=${prevMonth}`, action: 'صرف المستحقات' });
  if (billsToReview.length > 0) todos.push({ tone: 'warn', title: 'فاتورة كهرباء تختلف عن التعرفة', note: `في ${billsToReview.map((r) => branchName.get(r!.branch_id) ?? '').join('، ')} عن ${monthLong(month === currentMonth ? prevMonth : month)}`, href: `/${slug}/institute/cost?month=${month === currentMonth ? prevMonth : month}`, action: 'مقارنة بالتعرفة' });
  if (attentionCount > 0) todos.push({ tone: 'warn', title: `${ar(attentionCount)} أصول تحتاج متابعة`, note: 'صيانة متأخرة أو انتهى عمرها النافع أو بلا قاعة', href: `/${slug}/institute/setup`, action: 'عرض الأصول' });
  if (canMoney && me.can_read.cost && policiesR && !policiesR.approved) todos.push({ tone: 'warn', title: 'لا توجد سياسة تكلفة معتمدة', note: 'تقارير التكلفة والربحية لا تصدر إلا بسياسة معتمدة', href: `/${slug}/institute/cost`, action: 'إعداد السياسة' });

  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const b = 'branch' in extra ? extra.branch : branch;
    if (b) p.set('branch', b);
    const d = 'day' in extra ? extra.day : sp.day;
    if (d) p.set('day', d);
    const m = 'm' in extra ? extra.m : requested;
    if (m) p.set('m', m);
    const s = p.toString();
    return `/${slug}/institute${s ? `?${s}` : ''}`;
  };

  const noBranches = branches.length === 0;
  const noBranchesEarly = noBranches;
  const steps = [
    { done: branches.length > 0, title: 'أضف فرعاً', note: 'مثل الرياض أو جدة. لكل فرع قاعاته وفريقه وميزانيته.', href: `/${slug}/institute/setup`, action: 'إضافة فرع' },
    { done: (roomsR?.rooms.length ?? 0) > 0, title: 'سجّل القاعات والمعامل', note: 'بمساحتها وسعتها وقدرة أجهزتها؛ تُبنى عليها تكلفة الساعة.', href: `/${slug}/institute/setup`, action: 'إضافة قاعة' },
    { done: (programsR?.programs.length ?? 0) > 0, title: 'أنشئ برنامجاً بمستوياته ومواده', note: 'الدبلوم ثم المستوى ثم المادة بساعاتها.', href: `/${slug}/institute/academic`, action: 'إضافة برنامج' },
    { done: (instructorsR?.instructors.length ?? 0) > 0 && students.length > 0, title: 'أضف المدربين والطلاب', note: 'المدرب بأجر الساعة، والطالب بالبرنامج والمستوى.', href: `/${slug}/institute/academic`, action: 'إضافة' },
    { done: (upcomingR?.sessions.length ?? 0) + (monthSessionsR?.sessions.length ?? 0) > 0, title: 'جدوِل الحصص', note: 'النظام يمنع حجز القاعة أو المدرب في وقتين متداخلين.', href: `/${slug}/institute/academic`, action: 'جدولة حصة' },
  ];

  const delta = (cur: number, prev: number) => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);
  const last = income.length - 1;

  return (
    <div className="stack">
      <header className="ix-head">
        <div>
          <h1>لوحة اليوم</h1>
          <p>{dayLong(today)}{branch ? `، فرع ${branchName.get(branch) ?? ''}` : branches.length > 1 ? '، كل الفروع' : ''}.</p>
        </div>
        <div className="ix-tools">
        {canMoney && !noBranchesEarly && (
          <nav className="ix-seg" aria-label="الشهر">
            <Link href={q({ m: shiftMonth(month, -1) })}>{monthLong(shiftMonth(month, -1))}</Link>
            <Link href={q({ m: month })} aria-current="true">{monthLong(month)}</Link>
            {month < currentMonth && <Link href={q({ m: shiftMonth(month, 1) })}>{monthLong(shiftMonth(month, 1))}</Link>}
          </nav>
        )}
        {branches.length > 1 && (
          <nav className="ix-seg" aria-label="الفرع">
            <Link href={q({ branch: undefined })} aria-current={!branch ? 'true' : undefined}>كل الفروع</Link>
            {branches.map((b) => <Link key={b.id} href={q({ branch: b.id })} aria-current={branch === b.id ? 'true' : undefined}>{b.name}</Link>)}
          </nav>
        )}
        </div>
      </header>

      {autoPicked && (
        <p className="ix-note" role="status">
          <span>في الأيام العشرة الأولى من الشهر نعرض الشهر المكتمل ({monthLong(month)}) لأن أرقام {monthLong(currentMonth)} لم تتكوّن بعد.</span>
          <Link href={q({ m: currentMonth })}>عرض {monthLong(currentMonth)}</Link>
        </p>
      )}

      {noBranches ? (
        <section className="card" aria-labelledby="start-h">
          <h2 id="start-h">ابدأ بإعداد المعهد</h2>
          <p className="muted">خمس خطوات تكفي لتظهر هذه اللوحة بأرقامها. كل خطوة تفتح الصفحة المناسبة.</p>
          <ol className="ix-steps">
            {steps.map((s) => (
              <li key={s.title} className={s.done ? 'done' : undefined}>
                <div><b>{s.title}</b><p>{s.note}</p></div>
                {!s.done && <Link href={s.href} className="btn btn-ghost">{s.action}</Link>}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          <section className="ix-pulse" aria-label="أرقام الشهر">
            {canMoney ? (
              <>
                <div className="ix-fig">
                  <span className="ix-fig-label">المحصَّل في {monthLong(month)}</span>
                  <span className="ix-fig-value">{ar(income[last] ?? 0)}<small>ريال</small></span>
                  <span className="ix-fig-note">الشهر الماضي <b>{ar(income[last - 1] ?? 0)}</b>{delta(income[last] ?? 0, income[last - 1] ?? 0) !== null && <> · <span className={(delta(income[last] ?? 0, income[last - 1] ?? 0) ?? 0) >= 0 ? 'ix-pos' : 'ix-neg'}>{ar(Math.abs(delta(income[last] ?? 0, income[last - 1] ?? 0) ?? 0))}٪ {(delta(income[last] ?? 0, income[last - 1] ?? 0) ?? 0) >= 0 ? 'أعلى' : 'أقل'}</span></>}</span>
                  <Sparkline values={income} label="المحصَّل خلال ستة أشهر" />
                </div>
                <div className="ix-fig">
                  <span className="ix-fig-label">المصروفات والكهرباء</span>
                  <span className="ix-fig-value">{ar(spend[last] ?? 0)}<small>ريال</small></span>
                  <span className="ix-fig-note">الشهر الماضي <b>{ar(spend[last - 1] ?? 0)}</b></span>
                  <Sparkline values={spend} tone="spend" label="المصروفات خلال ستة أشهر" />
                </div>
                <div className="ix-fig">
                  <span className="ix-fig-label">الصافي النقدي</span>
                  <span className={`ix-fig-value ${(net[last] ?? 0) < 0 ? 'ix-neg' : ''}`}>{ar(net[last] ?? 0)}<small>ريال</small></span>
                  <span className="ix-fig-note">المحصَّل ناقص المصروف في الشهر. يشمل ضريبة الفواتير المحصَّلة.</span>
                </div>
              </>
            ) : (
              <>
                <div className="ix-fig">
                  <span className="ix-fig-label">الطلاب المنتظمون</span>
                  <span className="ix-fig-value">{ar(activeStudents)}</span>
                  <span className="ix-fig-note">من {ar(students.length)} طالباً مسجلاً</span>
                </div>
                <div className="ix-fig">
                  <span className="ix-fig-label">حصص منفذة هذا الشهر</span>
                  <span className="ix-fig-value">{ar(monthSessions.filter((s) => s.status === 'HELD').length)}</span>
                  <span className="ix-fig-note">وحصص قادمة <b>{ar(upcoming.filter((s) => s.status === 'SCHEDULED').length)}</b> خلال أسبوعين</span>
                </div>
                <div className="ix-fig">
                  <span className="ix-fig-label">القاعات النشطة</span>
                  <span className="ix-fig-value">{ar(rooms.length)}</span>
                  <span className="ix-fig-note">في {ar(new Set(rooms.map((r) => r.branch_id)).size)} {new Set(rooms.map((r) => r.branch_id)).size === 1 ? 'فرع' : 'فروع'}</span>
                </div>
              </>
            )}
            <div className="ix-fig">
              <span className="ix-fig-label">إشغال القاعات</span>
              <span className="ix-fig-value">{ar(occupancy, 1)}<small>٪</small></span>
              <span className="ix-fig-note">{ar(Math.round(heldMinutes / 60))} ساعة منفذة من {ar(rooms.length * availableHours)} ساعة متاحة هذا الشهر</span>
              <div className="ix-meter" role="img" aria-label={`الإشغال ${ar(occupancy, 1)} بالمئة`}><i style={{ width: `${occupancy}%` }} /></div>
            </div>
          </section>

          <section className="card" aria-labelledby="map-h">
            <div className="ix-head">
              <div>
                <h2 id="map-h">القاعات في {dayLong(day)}</h2>
                <p className="small muted">{daySessions.length === 0 ? 'لا توجد حصص في هذا اليوم.' : `${ar(daySessions.length)} ${daySessions.length === 1 ? 'حصة' : 'حصص'} على ${ar(new Set(daySessions.map((s) => s.roomId)).size)} قاعات. اضغط حصة لفتح كشف الحضور.`}</p>
              </div>
              <div className="ix-tools">
                <Link href={q({ day: shiftDay(day, -1) })} className="btn btn-ghost" aria-label="اليوم السابق">اليوم السابق</Link>
                {day !== today && <Link href={q({ day: undefined })} className="btn btn-ghost">اليوم</Link>}
                <Link href={q({ day: shiftDay(day, 1) })} className="btn btn-ghost" aria-label="اليوم التالي">اليوم التالي</Link>
              </div>
            </div>
            {rooms.length === 0 ? <p className="muted">لا توجد قاعات نشطة. أضفها من صفحة الإعداد.</p> : <DayMap rooms={dayRooms} sessions={daySessions} nowHour={nowHour} />}
            <DayLegend />
          </section>

          <div className="ix-cols">
            <section className="card" aria-labelledby="todo-h">
              <h2 id="todo-h">يحتاج متابعتك</h2>
              {todos.length === 0 ? (
                <ul className="ix-todo"><li className="ok"><i /><div><b>لا شيء يحتاج متابعة الآن</b><p>الفواتير والميزانيات والأصول والمستحقات ضمن المعتاد.</p></div><span /></li></ul>
              ) : (
                <ul className="ix-todo">
                  {todos.map((x) => (
                    <li key={x.title} className={x.tone}>
                      <i />
                      <div><b>{x.title}</b><p>{x.note}</p></div>
                      <Link href={x.href} className="btn btn-ghost">{x.action}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canMoney && !branch && branches.length > 1 && summaries[last] && (
              <section className="card" aria-labelledby="cmp-h">
                <h2 id="cmp-h">مقارنة الفروع في {monthLong(month)}</h2>
                <BranchBars rows={branches.map((b) => ({ name: b.name, income: Number(summaries[last]!.branches.find((x) => x.branch_id === b.id)?.income ?? 0), spend: Number(summaries[last]!.branches.find((x) => x.branch_id === b.id)?.spend ?? 0) }))} />
                <p className="small muted">بالريال، والمقياس واحد لكل الفروع.</p>
              </section>
            )}
            {(!canMoney || branch || branches.length <= 1) && (
              <section className="card" aria-labelledby="go-h">
                <h2 id="go-h">اختصارات</h2>
                <ul className="ix-links">
                  {[
                    { title: 'جدوِل حصة', note: 'قاعة ومدرب ووقت، مع منع التعارض.', href: `/${slug}/institute/academic`, action: 'الجدول' },
                    { title: 'سجّل طالباً', note: 'بالبرنامج والمستوى والجنسية.', href: `/${slug}/institute/academic`, action: 'الطلاب' },
                    ...(canMoney ? [{ title: 'أصدر فاتورة أو سجّل دفعة', note: 'بالضريبة المناسبة وأقساط شهرية.', href: `/${slug}/institute/finance`, action: 'المالية' }] : []),
                  ].map((s) => (
                    <li key={s.title}>
                      <div><b>{s.title}</b><p>{s.note}</p></div>
                      <Link href={s.href} className="btn btn-ghost">{s.action}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
