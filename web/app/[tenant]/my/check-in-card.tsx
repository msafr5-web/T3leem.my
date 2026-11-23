'use client';

import { useActionState } from 'react';
import type { CheckInState } from '@/lib/actions';
import type { AttendanceSession } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';

type Request = (prev: CheckInState) => Promise<CheckInState>;
type Confirm = (challengeId: string, prev: CheckInState, form: FormData) => Promise<CheckInState>;

const RESULT = { PRESENT: ['حاضر', 'badge ok'], LATE: ['متأخر', 'badge draft'], ABSENT: ['غائب', 'badge bad'], PENDING: ['قيد الاحتساب', 'badge'] } as const;

/** One session: check in with the e-mailed code while it is open; afterwards shows the check-in time or the settled result. */
export function CheckInCard({ session, requestAction, confirmAction }: { session: AttendanceSession; requestAction: Request; confirmAction: Confirm }) {
  const [asked, ask, asking] = useActionState(requestAction, {});
  const [done, confirm, confirming] = useActionState(confirmAction.bind(null, asked.challengeId ?? ''), {});
  const checkedIn = session.state === 'CHECKED_IN' || Boolean(done.done);
  const codeStep = Boolean(asked.challengeId) && !done.done;

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>{session.title}</h3>
      <p className="small muted">
        {session.kind === 'LIVE' ? 'جلسة مباشرة' : 'يوم من دورة مسجلة'} · {formatDateTime(session.starts_at)} ← {formatTime(session.ends_at)}
      </p>

      {session.result ? (
        <p>
          <span className={RESULT[session.result][1]}>{RESULT[session.result][0]}</span>
          {session.checked_in_at && <span className="small muted"> · سُجّل حضورك {formatTime(session.checked_in_at)}</span>}
        </p>
      ) : checkedIn ? (
        <>
          <p className="notice ok" role="status">
            سُجّل حضورك{done.done?.late ? ' (متأخراً)' : ''}. {session.kind === 'DAY' ? 'أكمل دروس اليوم لتُسجَّل انصرافك.' : 'ابقَ في الجلسة حتى نهايتها.'}
          </p>
          {done.done?.joinUrl && (
            <a href={done.done.joinUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              فتح الجلسة
            </a>
          )}
        </>
      ) : session.state === 'OPEN' ? (
        codeStep ? (
          <form action={confirm} className="stack" style={{ gap: 8 }}>
            <p className="small muted">أرسلنا رمزاً من ٦ أرقام إلى بريدك الإلكتروني. اكتبه هنا.</p>
            <input name="code" type="text" inputMode="numeric" dir="ltr" maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" required aria-label="رمز تأكيد الحضور" style={{ maxWidth: 160 }} />
            {done.error && (
              <p className="notice error" role="alert">
                {done.error}
              </p>
            )}
            <div>
              <button type="submit" className="btn btn-primary" disabled={confirming}>
                {confirming ? 'جارٍ التحقق…' : 'تأكيد الحضور'}
              </button>
            </div>
          </form>
        ) : (
          <form action={ask} className="stack" style={{ gap: 8 }}>
            <div>
              <button type="submit" className="btn btn-primary" disabled={asking}>
                {asking ? 'جارٍ الإرسال…' : 'تسجيل الحضور'}
              </button>
            </div>
            <p className="small muted">يصلك رمز على بريدك لتأكيد أنك أنت من يسجّل.</p>
            {(asked.error || done.error) && (
              <p className="notice error" role="alert">
                {asked.error ?? done.error}
              </p>
            )}
          </form>
        )
      ) : session.state === 'UPCOMING' ? (
        <p className="small muted">يُفتح تسجيل الحضور {formatTime(session.check_in_opens_at)} (قبل الجلسة بـ١٥ دقيقة).</p>
      ) : (
        <p className="small muted">انتهت الجلسة ولم يُسجَّل حضورك.</p>
      )}
    </div>
  );
}
