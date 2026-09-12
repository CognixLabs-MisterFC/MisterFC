import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { rewriteStaleActivePlayer } from '@/components/spectator/actions';
import { SpectatorShell } from '@/components/spectator/spectator-shell';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { evaluateSubscriptionGate } from '@/lib/subscription-gate';

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

  // SU-5 — GATE de SUSCRIPCIÓN. Este es el SEGUNDO punto común de la web, y el que se
  // olvida: esta carcasa es HERMANA de `(authenticated)`, no cuelga de su layout, así
  // que el guard de allí no la cubre. Ahora que los SEGUIDORES pagan (decisión de Jose
  // en la ronda de respuestas de SU-0), dejar este árbol sin gate sería regalar la app
  // entera a todo el que siga a un jugador — que es exactamente a quien se le cobra.
  //
  // Mismo helper, mismo interruptor y mismo criterio que en `(authenticated)`: no
  // bloquea con el gate apagado ni con una lectura fallida.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const gate = await evaluateSubscriptionGate(supabase);
  if (gate.blocked) {
    redirect(`/${locale}/suscripcion`);
  }

  return (
    <SpectatorShell ctx={ctx} locale={locale}>
      {children}
    </SpectatorShell>
  );
}
