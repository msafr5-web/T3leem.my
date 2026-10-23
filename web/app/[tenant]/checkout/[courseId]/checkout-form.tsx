'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { checkoutAction, type CheckoutState } from '@/lib/actions';

const METHODS = [
  { value: 'MADA', label: 'مدى' },
  { value: 'CREDIT_CARD', label: 'بطاقة ائتمانية' },
  { value: 'APPLE_PAY', label: 'Apple Pay' },
  { value: 'STC_PAY', label: 'STC Pay' },
];

const sar = new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2 });

export function CheckoutForm({ slug, courseId, totalLabel }: { slug: string; courseId: string; totalLabel: string }) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(checkoutAction.bind(null, slug, courseId), {});

  if (state.invoice) {
    const inv = state.invoice;
    return (
      <div className="stack">
        <p className="notice ok" role="status">
          تم الشراء بنجاح. أصبحت مسجّلاً في الدورة.
        </p>
        <div className="receipt">
          <div className="breakdown num">
            <div>
              <span className="muted">رقم الفاتورة</span>
              <span className="ltr">{inv.number}</span>
            </div>
            <div>
              <span className="muted">الضريبة</span>
              <span>{sar.format(inv.vat)}</span>
            </div>
            <div className="total">
              <span>المدفوع</span>
              <span>{sar.format(inv.total)}</span>
            </div>
          </div>
          {/* SVG generated server-side by the qrcode library from the ZATCA TLV payload. */}
          <div className="qr" role="img" aria-label="رمز QR للفاتورة الضريبية" dangerouslySetInnerHTML={{ __html: inv.qrSvg }} />
        </div>
        <p className="small muted">امسح الرمز بتطبيق ZATCA للتحقق من الفاتورة.</p>
        <div className="row-actions">
          <Link href={`/${slug}/learn/${courseId}`} className="btn btn-primary">
            ابدأ التعلم الآن
          </Link>
          <Link href={`/${slug}`} className="btn btn-ghost">
            تصفّح دورات أخرى
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="form">
      <fieldset className="methods">
        <legend className="small" style={{ marginBottom: 8, fontWeight: 500 }}>
          طريقة الدفع
        </legend>
        {METHODS.map((m, i) => (
          <label key={m.value} className="method" htmlFor={`pm-${m.value}`}>
            <input id={`pm-${m.value}`} type="radio" name="payment_method" value={m.value} defaultChecked={i === 0} />
            {m.label}
          </label>
        ))}
      </fieldset>

      <div className="notice sandbox">
        <strong>بيئة تجريبية:</strong> لن يُخصم أي مبلغ حقيقي.
        <label className="check" htmlFor="simulate_decline" style={{ marginTop: 6 }}>
          <input id="simulate_decline" type="checkbox" name="simulate_decline" />
          محاكاة رفض البطاقة
        </label>
      </div>

      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ تنفيذ الدفع…' : `ادفع ${totalLabel}`}
      </button>
    </form>
  );
}
