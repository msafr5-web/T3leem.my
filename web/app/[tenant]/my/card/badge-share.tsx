'use client';

import { useState } from 'react';

// Web NFC exists only in Chrome on Android over HTTPS; elsewhere the button is simply not shown.
interface NdefWriter { write(message: { records: { recordType: string; data: string }[] }): Promise<void> }
type NdefCtor = new () => NdefWriter;

export function BadgeShare({ url, vcardUrl }: { url: string; vcardUrl: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const nfc: NdefCtor | undefined = typeof window !== 'undefined' ? (window as unknown as { NDEFReader?: NdefCtor }).NDEFReader : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('تم نسخ الرابط.');
    } catch {
      setMsg('تعذّر النسخ، انسخ الرابط يدوياً.');
    }
  };
  const writeTag = async () => {
    if (!nfc) return;
    try {
      setMsg('قرّب بطاقة NFC من الجهاز…');
      await new nfc().write({ records: [{ recordType: 'url', data: url }] });
      setMsg('تمت الكتابة على بطاقة NFC.');
    } catch {
      setMsg('تعذّرت الكتابة على بطاقة NFC.');
    }
  };

  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={copy}>نسخ الرابط</button>
        <a className="btn btn-ghost" href={vcardUrl} download>حفظ في جهات الاتصال</a>
        {nfc && <button type="button" className="btn btn-ghost" onClick={writeTag}>كتابة على بطاقة NFC</button>}
      </div>
      {msg && <p className="small muted" role="status">{msg}</p>}
    </div>
  );
}
