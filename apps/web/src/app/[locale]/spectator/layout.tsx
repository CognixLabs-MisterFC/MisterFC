import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { SpectatorShell } from '@/components/spectator/spectator-shell';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { evaluateSubscriptionGate } from '@/lib/subscription-gate';
import { evaluateFamilyWebCut } from '@/lib/family-web-cut';

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

  // NO se reescribe aquí la cookie rancia, y el porqué importa: `cookies().set()`
  // lanza «Cookies can only be modified in a Server Action or Route Handler» en
  // pleno render de un Server Component. Esto llamaba a `rewriteStale…()`, que vive
  // en un fichero `'use server'` — pero eso solo la hace invocable DESDE EL CLIENTE;
  // llamarla desde aquí es una llamada de función normal y el `set` revienta igual.
  // Tiraba /es con un 500 en producción (digest 907647121, 2026-10).
  //
  // Y no se sustituye por un try/catch: la reescritura no hacía falta. El resolver
  // ya cae de forma determinista al primer club/jugador cuando la cookie no casa,
  // así que la pantalla sale correcta con la cookie rancia, y esta se corrige sola
  // en cuanto la persona cambia de club/nieto por el conmutador, que SÍ es una
  // Server Action de verdad. `ctx.staleCookie` se conserva como señal: léela, pero
  // no actúes sobre ella desde un render.

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

  // W-B — CORTE DE LA WEB PARA FAMILIAS. Segundo punto común, el que se olvida: esta
  // carcasa es HERMANA de `(authenticated)` y no cuelga de su layout, así que el corte
  // de allí no la cubre.
  //
  // Los seguidores entran en el corte por decisión expresa de Jose (punto 1 de la ronda
  // de respuestas). Sin esta línea, el corte tendría un agujero del tamaño de un árbol
  // entero: `/spectator` con sus cuatro secciones, abierto a todo el que siga a un
  // jugador. Es el mismo agujero que SU-5 tapó aquí mismo, y por el mismo motivo.
  //
  // Aquí NO hay guard de re-consentimiento al que respetar (un seguidor no es tutor, y
  // `tutor_needs_reconsent` necesita un club activo que esta carcasa no tiene), así que
  // el corte puede ir justo después del muro sin más consideraciones.
  const cut = await evaluateFamilyWebCut(supabase);
  if (cut.closed) {
    redirect(`/${locale}/aplicacion`);
  }

  return (
    <SpectatorShell ctx={ctx} locale={locale}>
      {children}
    </SpectatorShell>
  );
}
