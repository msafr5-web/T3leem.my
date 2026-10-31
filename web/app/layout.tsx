import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'T3leem.my', template: '%s · T3leem.my' },
  description: 'منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.',
  openGraph: { title: 'T3leem.my', description: 'منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.', siteName: 'T3leem.my', locale: 'ar_SA', type: 'website', images: [{ url: '/brand/og.jpg', width: 1200, height: 630, alt: 'T3leem.my' }] },
  twitter: { card: 'summary_large_image', images: ['/brand/og.jpg'] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0877c9' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* The official typeface (Aref Ruqaa, OFL): preloaded so text does not flash in a fallback font. */}
        <link rel="preload" href="/fonts/aref-ruqaa-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/aref-ruqaa-bold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
