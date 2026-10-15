import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { AuthHashHandler } from '@/components/auth-hash-handler';
import { Toaster } from '@/components/ui/sonner';
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
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MisterFC',
  },
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

  // Los textos de la web comercial (`webComercial`) se usan solo en el servidor: no
  // viajan al navegador en ninguna página. Sin esto irían en el HTML de TODAS las
  // pantallas de la app, y con la web comercial apagada el HTML ya no sería el de antes.
  const clientMessages = Object.fromEntries(
    Object.entries(await getMessages()).filter(([namespace]) => namespace !== 'webComercial'),
  );

  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <AuthHashHandler />
        </Suspense>
        <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
