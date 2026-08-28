import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUser,
  getCurrentUserClubs,
  createSupabaseServerClient,
  listTeamInvitationSummariesFromClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { InviteForm, type InviteFormTeam } from './invite-form';

type Props = {
  params: Promise<{ locale: string }>;
};

// director accede a la página de invitaciones (invita roles bajos). Mostrar/ocultar
// la opción 'director' según sea owner es F1B-3; el gate de alto es server-side + RLS.
// C-2b: la pantalla de invitaciones de club (invitar miembros/director) es solo
// dirección; el coordinador queda fuera (su gestión de staff de sus equipos vive en
// Cuerpo técnico, C-2c).
const ROLES_ALLOWED_TO_INVITE: Role[] = ['admin_club', 'director'];

export default async function InvitationsPage({ params }: Props) {
  const { locale } = await params;
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

  const supabase = createSupabaseServerClient(adapter);
  // NIVEL 1 — resumen por equipo (loader D2-3 reutilizado tal cual, sin cambios en core).
  const summaries = await listTeamInvitationSummariesFromClient(
    supabase,
    authorized.club.id,
  );

  // Equipos de la temporada activa para el selector OPCIONAL del formulario:
  // el resumen ya trae TODOS los equipos (incluidos los de 0 enviadas); la fila
  // "Sin equipo" (teamId null) no es un equipo, así que se descarta del selector.
  const formTeams: InviteFormTeam[] = summaries
    .filter((s): s is typeof s & { teamId: string; team_name: string } =>
      s.teamId !== null,
    )
    .map((s) => ({ id: s.teamId, name: s.team_name ?? '' }));

  const t = await getTranslations('invitations');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-12 text-white">
      <header>
        <h1 className="text-3xl font-bold text-[#10B981]">{t('title')}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {t('subtitle', { club: authorized.club.name })}
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          {t('new_section_title')}
        </h2>
        <InviteForm
          locale={locale}
          isOwner={authorized.isOwner}
          teams={formTeams}
        />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400">
          {t('by_team_title')}
        </h2>
        {summaries.length === 0 ? (
          <p className="text-sm text-zinc-400">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summaries.map((s) => {
              const teamName = s.teamId === null ? t('sin_equipo') : (s.team_name ?? '');
              // La fila "Sin equipo" enruta a un slug literal (teamId null no es UUID).
              const href = `/${locale}/invitations/${s.teamId ?? 'sin-equipo'}`;
              return (
                <li key={s.teamId ?? 'sin-equipo'}>
                  <Link
                    href={href}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm transition hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium text-white">
                        {s.team_color && (
                          <span
                            aria-hidden
                            className="inline-block size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: s.team_color }}
                          />
                        )}
                        <span className="truncate">{teamName}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-400">
                        <span>{t('summary.sent', { count: s.sent })}</span>
                        <span aria-hidden>·</span>
                        <span>{t('summary.accepted', { count: s.accepted })}</span>
                        <span aria-hidden>·</span>
                        <span>{t('summary.expired', { count: s.expired })}</span>
                        <span aria-hidden>·</span>
                        <span
                          className={s.pending > 0 ? 'font-medium text-amber-400' : undefined}
                        >
                          {t('summary.pending', { count: s.pending })}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-[#10B981]">
                      {t('open')} →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
