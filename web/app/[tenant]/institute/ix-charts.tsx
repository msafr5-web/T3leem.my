import Link from 'next/link';

const arNum = (n: number, digits = 0) => n.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const hourLabel = (h: number) => `${arNum(h)}:00`;

/**
 * A quiet trend line: no axes, no grid, the last point marked. Time runs in the reading direction of the page (right to left),
 * so the newest month is at the left end of the line.
 */
export function Sparkline({ values, tone = 'income', label }: { values: number[]; tone?: 'income' | 'spend'; label: string }) {
  const w = 160;
  const h = 38;
  const pad = 4;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  // oldest at the right (x = w - pad), newest at the left
  const pts = values.map((v, i) => [w - pad - i * step, h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${h - pad} L${pts[0]![0].toFixed(1)} ${h - pad} Z`;
  const last = pts[pts.length - 1]!;
  return (
    <svg className={`ix-spark ${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="area" d={area} />
      <path className="line" d={line} />
      <circle cx={last[0]} cy={last[1]} r="3" />
    </svg>
  );
}

export interface DaySession {
  id: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'HELD' | 'CANCELLED';
  title: string;
  who: string;
  href: string;
}
export interface DayRoom {
  id: string;
  name: string;
  detail: string;
}

const STATUS_WORD: Record<DaySession['status'], string> = { HELD: 'نُفِّذت', SCHEDULED: 'مجدولة', CANCELLED: 'ملغاة' };

/**
 * Rooms down the side, hours across: every session is a bar at its real time, coloured by status. One look answers
 * "which rooms are busy, which are free, and is anything missing today". Hours are Saudi time.
 */
export function DayMap({ rooms, sessions, from = 7, to = 21, nowHour }: { rooms: DayRoom[]; sessions: DaySession[]; from?: number; to?: number; nowHour: number | null }) {
  const span = to - from;
  const hours = Array.from({ length: Math.floor(span / 2) + 1 }, (_, i) => from + i * 2);
  const pos = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 3 * 3_600_000); // Saudi wall time
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  };
  const pct = (h: number) => Math.max(0, Math.min(100, ((h - from) / span) * 100));
  return (
    <div className="ix-map-wrap">
      <div className="ix-map ix-map-inner" role="table" aria-label="الجدول اليومي للقاعات">
        <div className="ix-map-head" role="row">
          <span />
          <div className="ix-map-axis" aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ insetInlineStart: `${pct(h)}%` }}>{hourLabel(h)}</span>
            ))}
          </div>
        </div>
        {rooms.map((room) => {
          const mine = sessions.filter((s) => s.roomId === room.id);
          return (
            <div key={room.id} className="ix-map-row" role="row">
              <div className="ix-map-room" role="rowheader">
                <strong>{room.name}</strong>
                <span>{room.detail}</span>
              </div>
              <div className="ix-map-track" role="cell">
                {nowHour !== null && nowHour >= from && nowHour <= to && <i className="ix-map-now" style={{ insetInlineStart: `${pct(nowHour)}%` }} aria-hidden="true" />}
                {mine.map((s) => {
                  const a = pos(s.startsAt);
                  const b = pos(s.endsAt);
                  return (
                    <Link key={s.id} href={s.href} className={`ix-map-bar ${s.status}`} style={{ insetInlineStart: `${pct(a)}%`, width: `${Math.max(2, pct(b) - pct(a))}%` }} title={`${s.title} — ${s.who} — ${STATUS_WORD[s.status]}`}>
                      <b>{s.title}</b>
                      <span>{s.who}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DayLegend() {
  return (
    <div className="ix-legend" aria-label="دلالة الألوان">
      <span><i className="HELD" />نُفِّذت</span>
      <span><i className="SCHEDULED" />مجدولة</span>
      <span><i className="CANCELLED" />ملغاة</span>
    </div>
  );
}

/** Paired horizontal bars per branch (collected vs spent), scaled to the largest figure so branches compare honestly. */
export function BranchBars({ rows }: { rows: { name: string; income: number; spend: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.spend]));
  return (
    <div className="ix-bars">
      {rows.map((r) => (
        <div key={r.name} className="ix-bar-group">
          <strong>{r.name}</strong>
          <div className="ix-bar">
            <span>المحصَّل</span>
            <div className="ix-bar-track"><i style={{ display: 'block', width: `${(r.income / max) * 100}%` }} /></div>
            <b>{arNum(r.income)}</b>
          </div>
          <div className="ix-bar spend">
            <span>المصروف</span>
            <div className="ix-bar-track"><i style={{ display: 'block', width: `${(r.spend / max) * 100}%` }} /></div>
            <b>{arNum(r.spend)}</b>
          </div>
        </div>
      ))}
    </div>
  );
}
