import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUser,
  getCurrentUserClubs,
  createSupabaseServerClient,
  listTeamInvitationSummariesFromClient,
  listTeamInvitationsFromClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
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

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) {
    redirect(`/${locale}/onboarding`);
  }

  const authorized = clubs.find((c) => ROLES_ALLOWED_TO_INVITE.includes(c.role));
  if (!authorized) {
    redirect(`/${locale}`);
  }

  const teamId = rawTeamId === NO_TEAM_SLUG ? null : rawTeamId;

  const supabase = createSupabaseServerClient(adapter);
  // NIVEL 2 — invitaciones del equipo (loader D2-3 reutilizado; el filtro de cuatro
  // es en cliente). El resumen da el nombre/color del equipo para la cabecera; ambos
  // loaders filtran por club (RLS + clubId) → un teamId de otro club queda vacío.
  const [rows, summaries] = await Promise.all([
    listTeamInvitationsFromClient(supabase, authorized.club.id, teamId),
    listTeamInvitationSummariesFromClient(supabase, authorized.club.id),
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
