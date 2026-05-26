import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'MisterFC',
    template: '%s · MisterFC',
  },
  description:
    'MisterFC — gestión, metodología y desarrollo deportivo para entrenadores de fútbol base y amateur. Cognix Labs.',
  applicationName: 'MisterFC',
  authors: [{ name: 'Iker Milla' }],
  creator: 'Cognix Labs',
};

export const viewport: Viewport = {
  themeColor: '#0F1B2E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
