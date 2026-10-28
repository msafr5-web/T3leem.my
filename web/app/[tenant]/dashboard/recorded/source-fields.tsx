import { riyadhInputs } from '@/lib/format';

/**
 * Channel + first-day date/time inputs (names match the API: channel_url, channel_name,
 * starts_on, lecture_time). Empty channel fields fall back to the video's own channel.
 */
export function SourceFields({ channelUrl, channelName, startsAt }: { channelUrl?: string | null; channelName?: string | null; startsAt?: string | null }) {
  const start = riyadhInputs(startsAt ?? null);
  return (
    <>
      <label htmlFor="channel_url">
        رابط قناة YouTube <span className="hint">(اختياري، يُقرأ من الفيديو تلقائياً)</span>
        <input id="channel_url" name="channel_url" type="url" dir="ltr" maxLength={300} placeholder="https://www.youtube.com/@With_fouad" defaultValue={channelUrl ?? ''} />
      </label>
      <label htmlFor="channel_name">
        اسم القناة أو الصفحة <span className="hint">(يظهر للمتدربين كمصدر للدورة)</span>
        <input id="channel_name" name="channel_name" type="text" maxLength={120} placeholder="مثال: With Fouad" defaultValue={channelName ?? ''} />
      </label>
      <label htmlFor="starts_on">
        تاريخ بداية الدورة <span className="hint">(اليوم الأول، ثم يُفتح يوم كل يوم)</span>
        <input id="starts_on" name="starts_on" type="date" defaultValue={start.date} />
      </label>
      <label htmlFor="lecture_time">
        وقت المحاضرة اليومية <span className="hint">(بتوقيت السعودية)</span>
        <input id="lecture_time" name="lecture_time" type="time" defaultValue={start.time || '19:00'} />
      </label>
    </>
  );
}
