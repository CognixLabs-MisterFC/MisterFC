'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { setActiveClub } from './actions';

/**
 * F14B-8 — Banner de "modo superadmin" visible SOLO cuando el superadmin está
 * dentro de un club AJENO (activeClub.isPlatformAccess). Acción "Salir": fija la
 * cookie de vuelta al club propio del superadmin (su membresía) y vuelve a la app;
 * si no tuviera club propio, vuelve a la consola. NO aparece en el club propio.
 */
export function SuperadminBanner({
  clubName,
  ownClubId,
}: {
  clubName: string;
  /** Club propio (membresía real) del superadmin al que volver; null si no tiene. */
  ownClubId: string | null;
}) {
  const t = useTranslations('platform');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onExit = () =>
    startTransition(async () => {
      if (ownClubId) {
        await setActiveClub(ownClubId);
        router.push('/');
        router.refresh();
      } else {
        router.push('/platform');
      }
    });

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-200">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        <span>{t('banner.text', { club: clubName })}</span>
      </div>
      <button
        type="button"
        onClick={onExit}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-500/20 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <LogOut className="size-3.5" aria-hidden />
        )}
        <span>{t('banner.exit')}</span>
      </button>
    </div>
  );
}
