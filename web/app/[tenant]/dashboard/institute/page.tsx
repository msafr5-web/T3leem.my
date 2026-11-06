import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  addAssetAction,
  addBranchAction,
  addRoomAction,
  deleteAssetAction,
  deleteRoomAction,
  removeMemberAction,
  saveMemberAction,
} from '@/lib/admin-actions';
import { ApiError, admin } from '@/lib/api';
import { formatNumber, isValidSlug } from '@/lib/format';
import { getSession } from '@/lib/session';
import { ActionForm, ConfirmAction } from '../health/health-forms';

export const metadata: Metadata = { title: 'إدارة المعهد' };

const NOTICES: Record<string, string> = { branch: 'تم حفظ الفرع.', room: 'تم تحديث القاعات.', asset: 'تم تحديث الأصول.', member: 'تم تحديث الأدوار.' };
const ROLE_LABEL: Record<string, string> = {
  HQ: 'الإدارة العليا (كل الفروع)',
  BRANCH_MANAGER: 'مدير فرع',
  FINANCE: 'المالية (كل الفروع)',
  STUDENT_AFFAIRS: 'شؤون الطلاب (فرع)',
  INSTRUCTOR: 'مدرب (قراءة القاعات)',
};
const KIND_LABEL: Record<string, string> = { CLASSROOM: 'قاعة', LAB: 'معمل', HALL: 'قاعة كبرى' };
const STATUS_LABEL: Record<string, string> = { IN_SERVICE: 'في الخدمة', MAINTENANCE: 'في الصيانة', RETIRED: 'خارج الخدمة' };

export default async function InstitutePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  if (!isValidSlug(slug)) redirect('/');
  const session = await getSession(slug);
  if (!session) redirect(`/${slug}/login?next=${encodeURIComponent(`/${slug}/dashboard/institute`)}`);
  if (session.role !== 'TENANT_ADMIN') redirect(`/${slug}`);

  let data;
  try {
    const [branches, rooms, assets, members] = await Promise.all([
      admin.instituteBranches(slug, session.token),
      admin.instituteRooms(slug, session.token),
      admin.instituteAssets(slug, session.token),
      admin.instituteMembers(slug, session.token),
    ]);
    data = { branches: branches.branches, rooms: rooms.rooms, assets: assets.assets, members: members.members, roles: members.roles };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'FEATURE_DISABLED') {
      return (
        <div className="stack">
          <h1>إدارة المعهد</h1>
          <p className="notice" role="status">هذه الوحدة غير مفعّلة لأكاديميتك. تواصل مع إدارة المنصة لتفعيلها.</p>
        </div>
      );
    }
    throw err;
  }

  const { branches, rooms, assets, members, roles } = data;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const notice = sp.saved ? NOTICES[sp.saved] : null;
  const BranchSelect = ({ name, required = true }: { name: string; required?: boolean }) => (
    <select name={name} required={required} defaultValue="">
      <option value="" disabled={required}>{required ? 'اختر الفرع' : 'كل الفروع'}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>إدارة المعهد</h1>
        <p className="muted">الفروع والقاعات والأصول وأدوار الفريق. كل فرع يرى مديره وفريقه سجلاته فقط، والإدارة العليا ترى الجميع.</p>
      </div>
      {notice && <div className="notice ok" role="status">{notice}</div>}

      <section className="card stack" aria-labelledby="branches-h">
        <h2 id="branches-h">الفروع ({formatNumber(branches.length)})</h2>
        {branches.length === 0 ? <p className="muted">لم تُضف فروع بعد.</p> : (
          <table className="table"><thead><tr><th>الفرع</th><th>المدينة</th><th>العنوان</th></tr></thead>
            <tbody>{branches.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.city ?? '—'}</td><td>{b.address ?? '—'}</td></tr>)}</tbody></table>
        )}
        <details>
          <summary>إضافة فرع</summary>
          <ActionForm action={addBranchAction.bind(null, slug)} submitLabel="إضافة الفرع">
            <label>اسم الفرع<input name="name" required maxLength={80} /></label>
            <label>المدينة<input name="city" maxLength={80} /></label>
            <label>العنوان<input name="address" maxLength={200} /></label>
          </ActionForm>
        </details>
      </section>

      <section className="card stack" aria-labelledby="rooms-h">
        <h2 id="rooms-h">القاعات والمعامل ({formatNumber(rooms.length)})</h2>
        {rooms.length === 0 ? <p className="muted">لا توجد قاعات.</p> : (
          <table className="table"><thead><tr><th>القاعة</th><th>الفرع</th><th>النوع</th><th>المساحة م²</th><th>السعة</th><th>القدرة كيلوواط</th><th /></tr></thead>
            <tbody>{rooms.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td>{branchName.get(r.branch_id) ?? '—'}</td><td>{KIND_LABEL[r.kind]}</td><td>{r.area_m2}</td><td>{formatNumber(r.capacity)}</td><td>{r.power_kw}</td>
                <td><ConfirmAction action={deleteRoomAction.bind(null, slug, r.id)} label="حذف" confirmText={`حذف القاعة ${r.name}؟`} variant="danger" /></td></tr>
            ))}</tbody></table>
        )}
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
      </section>

      <section className="card stack" aria-labelledby="assets-h">
        <h2 id="assets-h">الأصول والأجهزة ({formatNumber(assets.length)})</h2>
        {assets.length === 0 ? <p className="muted">لا توجد أصول مسجلة.</p> : (
          <table className="table"><thead><tr><th>الأصل</th><th>الفرع</th><th>القاعة</th><th>الحالة</th><th>قيمة الشراء</th><th /></tr></thead>
            <tbody>{assets.map((a) => (
              <tr key={a.id}><td>{a.name}{a.serial_no ? <span className="muted"> · {a.serial_no}</span> : null}</td><td>{branchName.get(a.branch_id) ?? '—'}</td><td>{a.room_id ? roomName.get(a.room_id) ?? '—' : '—'}</td><td>{STATUS_LABEL[a.status]}</td>
                <td>{a.purchase_value ?? '—'}</td>
                <td><ConfirmAction action={deleteAssetAction.bind(null, slug, a.id)} label="حذف" confirmText={`حذف الأصل ${a.name}؟`} variant="danger" /></td></tr>
            ))}</tbody></table>
        )}
        <details>
          <summary>إضافة أصل</summary>
          <ActionForm action={addAssetAction.bind(null, slug)} submitLabel="إضافة الأصل">
            <label>الفرع<BranchSelect name="branch_id" /></label>
            <label>القاعة <span className="hint">(من الفرع نفسه، اختياري)</span>
              <select name="room_id" defaultValue=""><option value="">بلا قاعة</option>{rooms.map((r) => <option key={r.id} value={r.id}>{branchName.get(r.branch_id)} — {r.name}</option>)}</select></label>
            <label>اسم الأصل<input name="name" required maxLength={120} /></label>
            <label>التصنيف<input name="category" maxLength={80} /></label>
            <label>الرقم التسلسلي<input name="serial_no" maxLength={80} dir="ltr" /></label>
            <label>تاريخ الشراء<input type="date" name="purchase_date" /></label>
            <label>قيمة الشراء (ريال)<input name="purchase_value" inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" dir="ltr" /></label>
            <label>القيمة المتبقية % <span className="hint">(الافتراضي 10)</span><input type="number" name="salvage_percent" min={0} max={100} step="0.01" /></label>
            <label>العمر النافع (شهر)<input type="number" name="useful_life_months" min={1} max={1200} /></label>
          </ActionForm>
        </details>
      </section>

      <section className="card stack" aria-labelledby="members-h">
        <h2 id="members-h">أدوار الفريق ({formatNumber(members.length)})</h2>
        <p className="small muted">مدير الأكاديمية هو الإدارة العليا تلقائياً. أضف هنا من يعمل على فرع أو مالية؛ يجب أن يكون لديه حساب في أكاديميتك أولاً.</p>
        {members.length > 0 && (
          <table className="table"><thead><tr><th>المستخدم</th><th>الدور</th><th>الفرع</th><th /></tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.id}><td>{m.full_name ?? m.email}<span className="muted" dir="ltr"> {m.email}</span></td><td>{ROLE_LABEL[m.role] ?? m.role}</td><td>{m.branch_id ? branchName.get(m.branch_id) ?? '—' : 'كل الفروع'}</td>
                <td><ConfirmAction action={removeMemberAction.bind(null, slug, m.user_id)} label="إزالة" confirmText="إزالة هذا الدور؟" variant="ghost" /></td></tr>
            ))}</tbody></table>
        )}
        <details>
          <summary>إضافة أو تعديل دور</summary>
          <ActionForm action={saveMemberAction.bind(null, slug)} submitLabel="حفظ الدور">
            <label>بريد المستخدم<input type="email" name="email" required dir="ltr" /></label>
            <label>الدور<select name="role" defaultValue="BRANCH_MANAGER">{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}</select></label>
            <label>الفرع <span className="hint">(مطلوب لمدير الفرع وشؤون الطلاب)</span><BranchSelect name="branch_id" required={false} /></label>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
