'use client';

import { useActionState } from 'react';
import type { CourseApprovalState } from '@/lib/admin-actions';

type Request = (prev: CourseApprovalState) => Promise<CourseApprovalState>;
type Approve = (challengeId: string, prev: CourseApprovalState, form: FormData) => Promise<CourseApprovalState>;

/**
 * Deleting a course that has trainees needs the platform owner's approval: step 1 e-mails a code to the OWNER,
 * step 2 takes the code he gives the admin. The code never appears on this screen.
 */
export function ApprovedDelete({ requestAction, approveAction, courseTitle, trainees }: { requestAction: Request; approveAction: Approve; courseTitle: string; trainees: number }) {
  const [asked, ask, asking] = useActionState(requestAction, {});
  const challengeId = asked.challengeId;
  // The second form is bound to the challenge once it exists; until then a harmless placeholder keeps the hook order stable.
  const [done, approve, approving] = useActionState(approveAction.bind(null, challengeId ?? ''), {});
  const open = Boolean(challengeId) && !(done.error && !done.challengeId);

  return (
    <div className="stack" style={{ gap: 12 }}>
      {!open && (
        <form action={ask} className="stack" style={{ gap: 8 }}>
          <div>
            <button type="submit" className="btn btn-danger" disabled={asking}>
              {asking ? 'جارٍ الإرسال…' : 'طلب موافقة المالك على حذف الدورة'}
            </button>
          </div>
          {asked.error && (
            <p className="notice error" role="alert">
              {asked.error}
            </p>
          )}
          {done.error && !done.challengeId && (
            <p className="notice error" role="alert">
              {done.error}
            </p>
          )}
        </form>
      )}
      {open && (
        <form
          action={approve}
          onSubmit={(e) => {
            if (!window.confirm(`حذف «${courseTitle}» نهائياً مع تسجيلات ${trainees} متدرب وتقدمهم وشهاداتهم؟ لا يمكن التراجع.`)) e.preventDefault();
          }}
          className="stack"
          style={{ gap: 8 }}
        >
          <p className="notice ok" role="status">
            أُرسل رمز الموافقة إلى بريد مالك المنصة. اطلبه منه واكتبه هنا (صالح ١٠ دقائق).
          </p>
          <label htmlFor="owner-code">
            رمز الموافقة (٦ أرقام)
            <input id="owner-code" name="code" type="text" inputMode="numeric" dir="ltr" maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" required style={{ maxWidth: 180 }} />
          </label>
          {done.error && (
            <p className="notice error" role="alert">
              {done.error}
            </p>
          )}
          <div className="cta-row">
            <button type="submit" className="btn btn-danger" disabled={approving}>
              {approving ? 'جارٍ الحذف…' : 'تأكيد الحذف النهائي'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
