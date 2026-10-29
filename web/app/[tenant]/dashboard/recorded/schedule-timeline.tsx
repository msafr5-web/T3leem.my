import type { ReactNode } from 'react';
import { formatTimestamp } from '@/lib/format';

export interface TimelineDay {
  key: string;
  title: string;
  lectures: { title?: string; start_second: number; end_second: number }[];
  /** Optional control shown in the day's header (e.g. the day's quiz builder). */
  action?: ReactNode;
}

/**
 * One row per day: lecture → break → … → lecture → discussion, block widths proportional to
 * minutes, so a provider sees the learner's day at a glance before creating the course.
 */
export function ScheduleTimeline({ days, breakMinutes, discussionMinutes }: { days: TimelineDay[]; breakMinutes: number; discussionMinutes: number }) {
  return (
    <ol className="timeline">
      {days.map((d) => {
        const videoMinutes = d.lectures.reduce((s, l) => s + (l.end_second - l.start_second) / 60, 0);
        const total = Math.round(videoMinutes + Math.max(0, d.lectures.length - 1) * breakMinutes + discussionMinutes);
        return (
          <li key={d.key} className="timeline-day">
            <div className="timeline-head">
              <strong>{d.title}</strong>
              <span className="timeline-meta">
                <span className="small muted">
                  {d.lectures.length} أجزاء · نحو {total} دقيقة إجمالاً
                </span>
                {d.action}
              </span>
            </div>
            <div className="timeline-track" role="list">
              {d.lectures.map((l, i) => {
                const mins = (l.end_second - l.start_second) / 60;
                return (
                  <span key={`${d.key}-${i}`} style={{ display: 'contents' }}>
                    <span role="listitem" className="block lecture" style={{ flexGrow: mins }} title={l.title}>
                      <b>الجزء {i + 1}</b>
                      <span className="ltr">
                        {formatTimestamp(l.start_second)}–{formatTimestamp(l.end_second)}
                      </span>
                      <span>{Math.round(mins)} د</span>
                    </span>
                    {i < d.lectures.length - 1 && breakMinutes > 0 && (
                      <span role="listitem" className="block pause" style={{ flexGrow: breakMinutes }}>
                        <b>استراحة</b>
                        <span>{breakMinutes} د</span>
                      </span>
                    )}
                  </span>
                );
              })}
              {discussionMinutes > 0 && (
                <span role="listitem" className="block talk" style={{ flexGrow: discussionMinutes }}>
                  <b>نقاش</b>
                  <span>{discussionMinutes} د</span>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
