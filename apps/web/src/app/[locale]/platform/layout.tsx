import type { ReactNode } from 'react';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireSuperadmin } from '@/lib/platform/guard';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * F14B-7 — Layout de la consola de plataforma. Rama `/platform` hermana de
 * `(authenticated)` bajo `[locale]` (NO anidada en ella): cuelga del root layout
 * (hereda i18n, estilos y Toaster) y NO exige club activo. El guard
 * `requireSuperadmin` protege TODAS las rutas de la consola (lista + detalle).
 * Shell mínimo propio, sin nav-por-club.
 */
export default async function PlatformLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireSuperadmin(locale);

  const t = await getTranslations('platform');

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 text-zinc-100">
        <Link
          href="/platform"
          className="flex items-center gap-2 font-semibold tracking-tight text-misterfc-green"
        >
          <ShieldCheck className="size-5 shrink-0" aria-hidden />
          <span>{t('console_title')}</span>
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span>{t('back_to_app')}</span>
        </Link>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
    </div>
  );
}
