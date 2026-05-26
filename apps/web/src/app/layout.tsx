import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
