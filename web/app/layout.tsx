import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Readex_Pro } from 'next/font/google';
import './globals.css';

const body = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const display = Readex_Pro({ subsets: ['arabic', 'latin'], weight: ['500', '700'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'T3leem.my', template: '%s · T3leem.my' },
  description: 'منصة سحابية لإطلاق أكاديميات التدريب الرقمية بهوية كل معهد.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
