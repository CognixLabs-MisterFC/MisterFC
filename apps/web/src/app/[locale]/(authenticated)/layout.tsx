import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { rewriteStaleActiveClub } from '@/components/shell/actions';
import { AppShell } from '@/components/shell/app-shell';
import { evaluateSubscriptionGate } from '@/lib/subscription-gate';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function AuthenticatedLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) {
    // Sin sesión o sin clubs. Decidir destino con una carga más barata: si
    // hay user, falta club → /onboarding; si no, falta sesión → /signin.
    const { loadAuthOnly } = await import('@/lib/auth-shell');
    const auth = await loadAuthOnly();
    if (!auth) redirect(`/${locale}/signin`);
    // F14C-4 — SEGUIDOR PURO: user autenticado, sin membership de club, pero
    // is_spectator() → su zona reducida, NO onboarding. (Prioridad al rol: si
    // tuviera cualquier membership, loadShellContext no habría devuelto null.)
    const { isPureSpectator } = await import('@/lib/spectator-shell');
    if (await isPureSpectator()) redirect(`/${locale}/spectator`);
    redirect(`/${locale}/onboarding`);
  }

  if (ctx.staleCookie) {
    await rewriteStaleActiveClub(ctx.activeClub.club.id);
  }

  // Un solo cliente para los tres guards que vienen (suscripción, re-consentimiento y
  // superadmin): son tres RPC sobre la MISMA sesión.
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // SU-5 — GATE de SUSCRIPCIÓN (guard SERVER-SIDE). Este es el PRIMER punto común de
  // la web: todo lo autenticado con club cuelga de aquí. El segundo es
  // `/spectator/layout.tsx`, que NO pasa por este fichero.
  //
  // Va ANTES del re-consentimiento, y es una decisión mía: pedirle a alguien que firme
  // los consentimientos de la temporada antes de que haya decidido si va a ser cliente
  // es crear un registro legal de quien puede no comprar. Al revés no se pierde nada:
  // quien paga y luego re-consiente hace el recorrido normal de cualquier compra. Si se
  // prefiere el orden contrario, es mover este bloque debajo del siguiente.
  //
  // `evaluateSubscriptionGate` no bloquea con el interruptor apagado ni con una lectura
  // fallida: "no se pudo leer" NO es "no tiene".
  const gate = await evaluateSubscriptionGate(supabase);
  if (gate.blocked) {
    redirect(`/${locale}/suscripcion`);
  }

  // F14-5 — GATE de re-consentimiento por temporada (guard SERVER-SIDE). Un tutor
  // (parent/guardian) sin T&C + Privacidad para la temporada ACTIVA no puede
  // navegar a ninguna ruta autenticada: se le redirige a la pantalla de
  // re-consentimiento (fuera de este layout, sin bucle). El staff nunca es tutor →
  // `tutor_needs_reconsent` devuelve false y no se ve afectado.
  const { data: needsReconsent } = await supabase.rpc('tutor_needs_reconsent', {
    p_club_id: ctx.activeClub.club.id,
  });
  if (needsReconsent) {
    redirect(`/${locale}/re-consentimiento`);
  }

  // F14B-7 — el superadmin ve un enlace extra a la consola de plataforma en el
  // shell. `is_superadmin()` es la única fuente de verdad; no es un rol de club,
  // así que NO va por nav-config (el nav filtra por rol de club).
  const { data: isSuper } = await supabase.rpc('is_superadmin');

  return (
    <AppShell ctx={ctx} locale={locale} isSuperadmin={isSuper === true}>
      {children}
    </AppShell>
  );
}
