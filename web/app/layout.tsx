import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Readex_Pro } from 'next/font/google';
import './globals.css';

const body = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const display = Readex_Pro({ subsets: ['arabic', 'latin'], weight: ['500', '700'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'T3leem.my', template: '%s · T3leem.my' },
  description: 'منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.',
  openGraph: { title: 'T3leem.my', description: 'منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.', siteName: 'T3leem.my', locale: 'ar_SA', type: 'website', images: [{ url: '/brand/og.jpg', width: 1200, height: 630, alt: 'T3leem.my' }] },
  twitter: { card: 'summary_large_image', images: ['/brand/og.jpg'] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b7ab8' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
