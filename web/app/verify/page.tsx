import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'التحقق من شهادة' };

async function lookup(form: FormData) {
  'use server';
  const code = String(form.get('code') ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  redirect(`/verify/${encodeURIComponent(code || 'NONE')}`);
}

export default function VerifyLookup() {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand-mark">
            <span className="brand-dot" aria-hidden="true">ت</span>
            T3leem.my
          </Link>
        </div>
      </header>
      <main className="container narrow stack">
        <h1>التحقق من شهادة</h1>
        <p className="muted">أدخل رمز التحقق المطبوع على الشهادة، أو امسح رمز QR الموجود عليها.</p>
        <form action={lookup} className="card form">
          <label htmlFor="code">
            رمز التحقق
            <input id="code" name="code" type="text" required dir="ltr" placeholder="T3L-XXXX-XXXX" maxLength={20} autoComplete="off" style={{ textTransform: 'uppercase' }} />
          </label>
          <button type="submit" className="btn btn-primary">
            تحقق
          </button>
        </form>
      </main>
    </>
  );
}
