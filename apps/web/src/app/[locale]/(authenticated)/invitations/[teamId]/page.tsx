import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  listTeamInvitationSummariesFromClient,
  listTeamInvitationsFromClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { TeamInvitationsList } from './team-invitations-list';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

// Mismo gate que el nivel 1 (solo dirección administra invitaciones).
const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'director'];

// La fila "Sin equipo" (team_id null) no tiene UUID: se enruta con un slug literal.
const NO_TEAM_SLUG = 'sin-equipo';

export default async function TeamInvitationsPage({ params }: Props) {
  const { locale, teamId: rawTeamId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  // El club del que se administran invitaciones es el ACTIVO, no «el primero de
  // mis clubes que me deja invitar». Antes esto era
  // `clubs.find((c) => ROLES_ALLOWED_TO_INVITE.includes(c.role))`: coge el primer
  // club de la lista de membresías —que `fetchUserClubs` ordena por nombre con
  // localeCompare— y NO lee la cookie `active_club_id`. Con dos clubes ganaba
  // siempre el alfabéticamente primero, así que entrando en UDFonteta se veían
  // las invitaciones de CD Ejemplo, y encima la cabecera nombraba a CD Ejemplo.
  //
  // Se usa `loadShellContext` y NO `resolveActiveClub` a pelo, que es la trampa:
  // para un SUPERADMIN en un club ajeno ese club NO está en sus membresías, y es
  // el shell quien fabrica el CurrentUserClub sintético (F14B-8). Con el resolver
  // a secas la cookie no casaría, devolvería staleCookie y volvería a caer en
  // clubs[0] — el mismo fallo con otro nombre.
  //
  // Y aquí no hay red de seguridad debajo: `user_role_in_club` devuelve
  // 'admin_club' a un superadmin en CUALQUIER club (F14B-2,
  // 20260921000000_f14b_2_superadmin_chokepoint), así que la RLS de invitations
  // no acota nada en su caso. El club que pasa esta página es la única puerta.
  const active = ctx.activeClub;
  const role = active.role as Role;

  // El rol se mide EN EL CLUB ACTIVO. Cambio de comportamiento deliberado: un
  // director del club B cuyo club activo es A (donde no dirige) ya no administra
  // aquí las invitaciones de B — cambia de club en el conmutador. Antes las veía,
  // que es exactamente el fallo.
  if (!ROLES_ALLOWED_TO_INVITE.includes(role)) {
    redirect(`/${locale}`);
  }

  const teamId = rawTeamId === NO_TEAM_SLUG ? null : rawTeamId;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // NIVEL 2 — invitaciones del equipo (loader D2-3 reutilizado; el filtro de cuatro
  // es en cliente). El resumen da el nombre/color del equipo para la cabecera; ambos
  // loaders filtran por club (RLS + clubId) → un teamId de otro club queda vacío.
  const [rows, summaries] = await Promise.all([
    listTeamInvitationsFromClient(supabase, active.club.id, teamId),
    listTeamInvitationSummariesFromClient(supabase, active.club.id),
  ]);

  const t = await getTranslations('invitations');
  const summary = summaries.find((s) => s.teamId === teamId);
  const teamName =
    teamId === null ? t('sin_equipo') : (summary?.team_name ?? '');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12 text-white">
      <div>
        <Link
          href={`/${locale}/invitations`}
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← {t('back')}
        </Link>
      </div>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#10B981]">
          {summary?.team_color && teamId !== null && (
            <span
              aria-hidden
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ backgroundColor: summary.team_color }}
            />
          )}
          {teamName}
        </h1>
      </header>

      <TeamInvitationsList locale={locale} rows={rows} />
    </main>
  );
}
