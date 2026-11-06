import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addAssetAction,
  addBranchAction,
  addDepartmentAction,
  addRoomAction,
  addStaffAction,
  deleteAssetAction,
  deleteDepartmentAction,
  deleteRoomAction,
  deleteStaffAction,
  importAssetsAction,
  logMaintenanceAction,
  removeMemberAction,
  saveMemberAction,
} from '@/lib/institute-actions';
import { ApiError, admin, type InstAttention } from '@/lib/api';
import { formatNumber, isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../dashboard/health/health-forms';
import { AssetImportForm } from './institute-forms';

export const metadata: Metadata = { title: 'إدارة المعهد' };

const NOTICES: Record<string, string> = {
  branch: 'تم حفظ الفرع.',
  room: 'تم تحديث القاعات.',
  asset: 'تم تحديث الأصول.',
  member: 'تم تحديث الأدوار.',
  department: 'تم تحديث الأقسام.',
  staff: 'تم تحديث الموظفين.',
  maintenance: 'تم تسجيل الصيانة.',
};
const ROLE_LABEL: Record<string, string> = {
  HQ: 'الإدارة العليا (كل الفروع)',
  BRANCH_MANAGER: 'مدير فرع',
  FINANCE: 'المالية (كل الفروع)',
  STUDENT_AFFAIRS: 'شؤون الطلاب (فرع)',
  INSTRUCTOR: 'مدرب (قراءة القاعات)',
};
const KIND_LABEL: Record<string, string> = { CLASSROOM: 'قاعة', LAB: 'معمل', HALL: 'قاعة كبرى' };
const STATUS_LABEL: Record<string, string> = { IN_SERVICE: 'في الخدمة', MAINTENANCE: 'في الصيانة', RETIRED: 'خارج الخدمة' };
const REASON_LABEL: Record<InstAttention['items'][number]['reasons'][number], string> = {
  IN_MAINTENANCE: 'في الصيانة',
  MAINTENANCE_OVERDUE: 'صيانة متأخرة',
  END_OF_LIFE: 'انتهى عمره النافع',
  NO_ROOM: 'بلا قاعة',
};
const MAINT_KIND: Record<string, string> = { INSPECTION: 'فحص', REPAIR: 'إصلاح', SERVICE: 'صيانة دورية' };

/** A read the role is not allowed to make (403) just hides that section; any other failure is a real error. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null;
    throw err;
  }
}

export default async function InstitutePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/institute`)}`);
  const t = session.token;

  let me;
  try {
    me = await admin.instituteMe(slug, t);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'FEATURE_DISABLED' || err.status === 403)) {
      return (
        <div className="stack">
          <h1>إدارة المعهد</h1>
          <p className="notice" role="status">
            {err.code === 'FEATURE_DISABLED' ? 'هذه الوحدة غير مفعّلة لأكاديميتك. تواصل مع إدارة المنصة لتفعيلها.' : 'ليس لديك دور في إدارة المعهد. اطلب من إدارة الأكاديمية إضافتك.'}
          </p>
        </div>
      );
    }
    throw err;
  }

  const [branches, rooms, assets, members, departments, staff, attention] = await Promise.all([
    orNull(admin.instituteBranches(slug, t)),
    orNull(admin.instituteRooms(slug, t)),
    orNull(admin.instituteAssets(slug, t)),
    orNull(admin.instituteMembers(slug, t)),
    orNull(admin.instituteDepartments(slug, t)),
    orNull(admin.instituteStaff(slug, t)),
    orNull(admin.instituteAttention(slug, t)),
  ]);
  const w = me.can_write;
  const branchList = branches?.branches ?? [];
  const roomList = rooms?.rooms ?? [];
  const assetList = assets?.assets ?? [];
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const roomName = new Map(roomList.map((r) => [r.id, r.name]));
  const deptName = new Map((departments?.departments ?? []).map((d) => [d.id, d.name]));
  const assetName = new Map(assetList.map((a) => [a.id, a.name]));
  const notice = sp.saved ? NOTICES[sp.saved] : null;
  const wideBranch = me.branch_id === null; // HQ and finance span every branch
  const showMoney = assetList.some((a) => a.purchase_value !== undefined);

  const BranchSelect = ({ name, required = true, wide = false }: { name: string; required?: boolean; wide?: boolean }) => (
    <select name={name} required={required} defaultValue={!wide && branchList.length === 1 ? branchList[0]?.id : ''}>
      <option value="" disabled={required}>{required ? 'اختر الفرع' : wide ? 'كل الفروع (مستوى المعهد)' : 'كل الفروع'}</option>
      {branchList.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>إدارة المعهد</h1>
          <p className="muted">
            دورك: <strong>{ROLE_LABEL[me.role] ?? me.role}</strong>
            {me.branch_id ? ` · فرع ${branchName.get(me.branch_id) ?? ''}` : ''}. ترى هنا ما يسمح به دورك فقط.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/${slug}/institute/academic`} className="btn btn-primary">الدبلومات والطلاب والجداول</Link>
          {session.role === 'TENANT_ADMIN' && <Link href={`/${slug}/dashboard`} className="btn btn-ghost">لوحة التحكم</Link>}
        </div>
      </div>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {attention && attention.items.length > 0 && (
        <section className="card stack" aria-labelledby="attn-h">
          <h2 id="attn-h">أصول تحتاج متابعة ({formatNumber(attention.items.length)})</h2>
          <ul className="stack" style={{ gap: 6 }}>
            {attention.items.map((i) => (
              <li key={i.asset_id}>
                {assetName.get(i.asset_id) ?? 'أصل'}: {i.reasons.map((r) => REASON_LABEL[r]).join('، ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {branches && (
        <section className="card stack" aria-labelledby="branches-h">
          <h2 id="branches-h">الفروع ({formatNumber(branchList.length)})</h2>
          {branchList.length === 0 ? <p className="muted">لم تُضف فروع بعد.</p> : (
            <table className="table"><thead><tr><th>الفرع</th><th>المدينة</th><th>العنوان</th></tr></thead>
              <tbody>{branchList.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.city ?? '—'}</td><td>{b.address ?? '—'}</td></tr>)}</tbody></table>
          )}
          {w.branch && (
            <details>
              <summary>إضافة فرع</summary>
              <ActionForm action={addBranchAction.bind(null, slug)} submitLabel="إضافة الفرع">
                <label>اسم الفرع<input name="name" required maxLength={80} /></label>
                <label>المدينة<input name="city" maxLength={80} /></label>
                <label>العنوان<input name="address" maxLength={200} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {rooms && (
        <section className="card stack" aria-labelledby="rooms-h">
          <h2 id="rooms-h">القاعات والمعامل ({formatNumber(roomList.length)})</h2>
          {roomList.length === 0 ? <p className="muted">لا توجد قاعات.</p> : (
            <table className="table"><thead><tr><th>القاعة</th><th>الفرع</th><th>النوع</th><th>المساحة م²</th><th>السعة</th><th>القدرة كيلوواط</th>{w.room && <th />}</tr></thead>
              <tbody>{roomList.map((r) => (
                <tr key={r.id}><td>{r.name}</td><td>{branchName.get(r.branch_id) ?? '—'}</td><td>{KIND_LABEL[r.kind]}</td><td>{r.area_m2}</td><td>{formatNumber(r.capacity)}</td><td>{r.power_kw}</td>
                  {w.room && <td><ConfirmAction action={deleteRoomAction.bind(null, slug, r.id)} label="حذف" confirmText={`حذف القاعة ${r.name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.room && (
            <details>
              <summary>إضافة قاعة أو معمل</summary>
              <ActionForm action={addRoomAction.bind(null, slug)} submitLabel="إضافة القاعة">
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>الاسم<input name="name" required maxLength={80} /></label>
                <label>النوع<select name="kind" defaultValue="CLASSROOM">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>المساحة (م²)<input type="number" name="area_m2" required min={1} step="0.01" inputMode="decimal" /></label>
                <label>السعة (طالب)<input type="number" name="capacity" required min={1} /></label>
                <label>قدرة الأجهزة (كيلوواط) <span className="hint">تُستعمل لتوزيع الكهرباء</span><input type="number" name="power_kw" min={0} step="0.01" inputMode="decimal" defaultValue={0} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {assets && (
        <section className="card stack" aria-labelledby="assets-h">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h2 id="assets-h">الأصول والأجهزة ({formatNumber(assetList.length)})</h2>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a href={`/${slug}/institute/export`} className="btn btn-ghost">تصدير Excel</a>
              {w.asset && <a href={`/${slug}/institute/export?template=1`} className="btn btn-ghost">قالب الاستيراد</a>}
            </div>
          </div>
          {assetList.length === 0 ? <p className="muted">لا توجد أصول مسجلة.</p> : (
            <table className="table"><thead><tr><th>الأصل</th><th>الفرع</th><th>القاعة</th><th>الحالة</th>{showMoney && <th>قيمة الشراء</th>}{w.asset && <th />}</tr></thead>
              <tbody>{assetList.map((a) => (
                <tr key={a.id}><td>{a.name}{a.serial_no ? <span className="muted"> · {a.serial_no}</span> : null}</td><td>{branchName.get(a.branch_id) ?? '—'}</td><td>{a.room_id ? roomName.get(a.room_id) ?? '—' : '—'}</td><td>{STATUS_LABEL[a.status]}</td>
                  {showMoney && <td>{a.purchase_value ?? '—'}</td>}
                  {w.asset && <td><ConfirmAction action={deleteAssetAction.bind(null, slug, a.id)} label="حذف" confirmText={`حذف الأصل ${a.name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.asset && (
            <>
              <details>
                <summary>إضافة أصل</summary>
                <ActionForm action={addAssetAction.bind(null, slug)} submitLabel="إضافة الأصل">
                  <label>الفرع<BranchSelect name="branch_id" /></label>
                  <label>القاعة <span className="hint">(من الفرع نفسه، اختياري)</span>
                    <select name="room_id" defaultValue=""><option value="">بلا قاعة</option>{roomList.map((r) => <option key={r.id} value={r.id}>{branchName.get(r.branch_id)} — {r.name}</option>)}</select></label>
                  <label>اسم الأصل<input name="name" required maxLength={120} /></label>
                  <label>التصنيف<input name="category" maxLength={80} /></label>
                  <label>الرقم التسلسلي<input name="serial_no" maxLength={80} dir="ltr" /></label>
                  <label>تاريخ الشراء<input type="date" name="purchase_date" /></label>
                  {showMoney || me.role !== 'STUDENT_AFFAIRS' ? (
                    <>
                      <label>قيمة الشراء (ريال)<input name="purchase_value" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
                      <label>القيمة المتبقية % <span className="hint">(الافتراضي 10)</span><input type="number" name="salvage_percent" min={0} max={100} step="0.01" /></label>
                      <label>العمر النافع (شهر)<input type="number" name="useful_life_months" min={1} max={1200} /></label>
                    </>
                  ) : null}
                </ActionForm>
              </details>
              <details>
                <summary>استيراد أصول من Excel</summary>
                <AssetImportForm action={importAssetsAction.bind(null, slug)} />
              </details>
              {assetList.length > 0 && (
                <details>
                  <summary>تسجيل صيانة أو فحص</summary>
                  <ActionForm action={logMaintenanceAction.bind(null, slug)} submitLabel="تسجيل">
                    <label>الأصل<select name="asset_id" required defaultValue=""><option value="" disabled>اختر الأصل</option>{assetList.map((a) => <option key={a.id} value={a.id}>{branchName.get(a.branch_id)} — {a.name}</option>)}</select></label>
                    <label>النوع<select name="kind" defaultValue="SERVICE">{Object.entries(MAINT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label>تاريخ العمل<input type="date" name="performed_on" required /></label>
                    <label>الاستحقاق التالي <span className="hint">(اختياري)</span><input type="date" name="next_due_on" /></label>
                    {showMoney && <label>التكلفة (ريال)<input name="cost" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>}
                    <label>ملاحظات<input name="notes" maxLength={500} /></label>
                  </ActionForm>
                </details>
              )}
            </>
          )}
        </section>
      )}

      {departments && (
        <section className="card stack" aria-labelledby="dept-h">
          <h2 id="dept-h">الأقسام ({formatNumber(departments.departments.length)})</h2>
          {departments.departments.length === 0 ? <p className="muted">لا توجد أقسام.</p> : (
            <table className="table"><thead><tr><th>القسم</th><th>المستوى</th>{w.department && <th />}</tr></thead>
              <tbody>{departments.departments.map((d) => (
                <tr key={d.id}><td>{d.name}</td><td>{d.branch_id ? branchName.get(d.branch_id) ?? '—' : 'المعهد كله'}</td>
                  {w.department && (wideBranch || d.branch_id) && <td><ConfirmAction action={deleteDepartmentAction.bind(null, slug, d.id)} label="حذف" confirmText={`حذف القسم ${d.name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.department && (
            <details>
              <summary>إضافة قسم</summary>
              <ActionForm action={addDepartmentAction.bind(null, slug)} submitLabel="إضافة القسم">
                <label>اسم القسم<input name="name" required maxLength={80} /></label>
                <label>المستوى<BranchSelect name="branch_id" required={!wideBranch} wide={wideBranch} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {staff && (
        <section className="card stack" aria-labelledby="staff-h">
          <h2 id="staff-h">الموظفون ({formatNumber(staff.staff.length)})</h2>
          {staff.staff.length === 0 ? <p className="muted">لا يوجد موظفون مسجلون.</p> : (
            <table className="table"><thead><tr><th>الاسم</th><th>المسمى</th><th>الفرع</th><th>القسم</th><th>التواصل</th>{w.staff && <th />}</tr></thead>
              <tbody>{staff.staff.map((s) => (
                <tr key={s.id}><td>{s.full_name}{!s.active ? <span className="muted"> (غير نشط)</span> : null}</td><td>{s.job_title ?? '—'}</td><td>{branchName.get(s.branch_id) ?? '—'}</td><td>{s.department_id ? deptName.get(s.department_id) ?? '—' : '—'}</td><td dir="ltr">{s.phone ?? s.email ?? '—'}</td>
                  {w.staff && <td><ConfirmAction action={deleteStaffAction.bind(null, slug, s.id)} label="حذف" confirmText={`حذف ${s.full_name}؟`} variant="danger" /></td>}</tr>
              ))}</tbody></table>
          )}
          {w.staff && (
            <details>
              <summary>إضافة موظف</summary>
              <ActionForm action={addStaffAction.bind(null, slug)} submitLabel="إضافة الموظف">
                <label>الفرع<BranchSelect name="branch_id" /></label>
                <label>القسم <span className="hint">(من الفرع أو من المعهد كله)</span>
                  <select name="department_id" defaultValue=""><option value="">بلا قسم</option>{(departments?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.branch_id ? branchName.get(d.branch_id) : 'المعهد كله'} — {d.name}</option>)}</select></label>
                <label>الاسم الكامل<input name="full_name" required maxLength={120} /></label>
                <label>المسمى الوظيفي<input name="job_title" maxLength={80} /></label>
                <label>الجوال<input name="phone" maxLength={30} dir="ltr" inputMode="tel" /></label>
                <label>البريد<input type="email" name="email" dir="ltr" /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      {members && (
        <section className="card stack" aria-labelledby="members-h">
          <h2 id="members-h">أدوار الفريق ({formatNumber(members.members.length)})</h2>
          <p className="small muted">مدير الأكاديمية هو الإدارة العليا تلقائياً. أضف هنا من يعمل على فرع أو مالية؛ يجب أن يكون لديه حساب في أكاديميتك أولاً، ثم يدخل بعدها ويجد هذه الصفحة.</p>
          {members.members.length > 0 && (
            <table className="table"><thead><tr><th>المستخدم</th><th>الدور</th><th>الفرع</th><th /></tr></thead>
              <tbody>{members.members.map((m) => (
                <tr key={m.id}><td>{m.full_name ?? m.email}<span className="muted" dir="ltr"> {m.email}</span></td><td>{ROLE_LABEL[m.role] ?? m.role}</td><td>{m.branch_id ? branchName.get(m.branch_id) ?? '—' : 'كل الفروع'}</td>
                  <td><ConfirmAction action={removeMemberAction.bind(null, slug, m.user_id)} label="إزالة" confirmText="إزالة هذا الدور؟" variant="ghost" /></td></tr>
              ))}</tbody></table>
          )}
          {w.member && (
            <details>
              <summary>إضافة أو تعديل دور</summary>
              <ActionForm action={saveMemberAction.bind(null, slug)} submitLabel="حفظ الدور">
                <label>بريد المستخدم<input type="email" name="email" required dir="ltr" /></label>
                <label>الدور<select name="role" defaultValue="BRANCH_MANAGER">{members.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}</select></label>
                <label>الفرع <span className="hint">(مطلوب لمدير الفرع وشؤون الطلاب)</span><BranchSelect name="branch_id" required={false} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
