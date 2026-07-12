import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { rewriteStaleActivePlayer } from '@/components/spectator/actions';
import { SpectatorShell } from '@/components/spectator/spectator-shell';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * F14C-4 — Layout de la zona del SEGUIDOR PURO (hermana de `(authenticated)`,
 * patrón de `/platform`). NO usa loadShellContext (que asume club/rol): tiene su
 * propio contexto reducido. Un usuario con rol de club NUNCA ve esta carcasa —
 * loadSpectatorContext devuelve null si tiene cualquier membership, y lo
 * mandamos de vuelta al chokepoint `/` (que resuelve su shell normal).
 */
export default async function SpectatorLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) {
    // No es seguidor puro (sin sesión, con membership, o no-espectador).
    // Delegamos al único chokepoint: `/` → (authenticated) decide signin /
    // onboarding / shell normal. Así no duplicamos el rutado aquí.
    redirect(`/${locale}/`);
  }

  if (ctx.staleCookie) {
    await rewriteStaleActivePlayer(ctx.activePlayer.playerId);
  }

  return (
    <SpectatorShell ctx={ctx} locale={locale}>
      {children}
    </SpectatorShell>
  );
}
