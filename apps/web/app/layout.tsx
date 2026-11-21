import type { Metadata, Viewport } from 'next';
import { Noto_Nastaliq_Urdu } from 'next/font/google';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { HistoryGuard } from '@/components/history-guard';
import { ServiceWorker } from '@/components/service-worker';
import './globals.css';

const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-nastaliq',
});

export const metadata: Metadata = {
  title: 'Haqdaar — حقدار',
  description:
    'Claim your relief payment by voice, in Urdu, even offline. Prototype only — not an official service.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'حقدار', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#0b6b4f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ur" dir="rtl" className={nastaliq.variable}>
      <body>
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorker />
        <HistoryGuard />
      </body>
    </html>
  );
}
