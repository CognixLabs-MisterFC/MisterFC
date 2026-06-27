import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Swords } from 'lucide-react';
import { createSupabaseServerClient, teamsInActiveSeason } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { SignalIcon } from '@/components/plays/signal-icon';
import { loadTeamPlaybook } from '../../jugadas/queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ team?: string }>;
};

/**
 * F13.6/JR — Índice del Playbook del jugador/familia: LISTA de todas las jugadas
 * compartidas con su equipo (publicadas + shared_with_family, las que ya ve por la
 * RLS de #231). Cada ítem abre el visor read-only existente (/mi-equipo/jugadas/[id]).
 * Sustituye al listado incrustado en la card de /mi-equipo. Resolución de equipo =
 * mismo patrón que /mi-equipo (player_accounts → team_members activos → temporada
 * activa; query param ?team o el primero). Solo `jugador`.
 */
export default async function MiEquipoPlaybookPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_equipo');
  const tSig = await getTranslations('jugadas.signals');
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // Players del user en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id)')
    .eq('profile_id', ctx.user.id);
  type PA = { player_id: string; players: { id: string; club_id: string } };
  const myPlayerIds = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === clubId)
    .map((p) => p.player_id);

  // Teams del jugador (activos), acotados a la temporada activa (Bug-1, igual que /mi-equipo).
  let myTeams: { team_id: string; name: string }[] = [];
  if (myPlayerIds.length > 0) {
    const { data: tmRows } = await supabase
      .from('team_members')
      .select('player_id, team_id, teams!inner(id, name, season, categories!inner(club_id))')
      .in('player_id', myPlayerIds)
      .is('left_at', null);
    type TM = {
      player_id: string;
      team_id: string;
      teams: { id: string; name: string; season: string; categories: { club_id: string } };
    };
    const activeSeason = await getActiveSeasonLabel(supabase, clubId);
    myTeams = teamsInActiveSeason(
      ((tmRows ?? []) as unknown as TM[])
        .filter((r) => r.teams.categories.club_id === clubId)
        .map((r) => ({ team_id: r.team_id, name: r.teams.name, season: r.teams.season })),
      activeSeason,
    ).map((r) => ({ team_id: r.team_id, name: r.name }));
  }

  const activeTeam = myTeams.find((tm) => tm.team_id === sp.team) ?? myTeams[0] ?? null;
  const playbook = activeTeam ? await loadTeamPlaybook(clubId, activeTeam.team_id) : [];

  function teamHref(teamId: string): string {
    return `/mi-equipo/jugadas?team=${teamId}`;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/mi-equipo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('session.back')}
      </Link>

      <div className="flex flex-col">
        <h1 className="text-3xl font-bold tracking-tight">{t('playbook.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('playbook.subtitle')}</p>
      </div>

      {/* Cambio de equipo (solo si el jugador/familia tiene varios). */}
      {myTeams.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b">
          {myTeams.map((tm) => (
            <Link
              key={tm.team_id}
              href={teamHref(tm.team_id)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                activeTeam?.team_id === tm.team_id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tm.name}
            </Link>
          ))}
        </div>
      )}

      {playbook.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Swords className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('cards.playbook.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {playbook.map((p) => (
            <li key={p.id}>
              <Link
                href={`/mi-equipo/jugadas/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-foreground/30"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {p.signal_id ? (
                    <SignalIcon
                      signalId={p.signal_id}
                      className="size-6 shrink-0 text-foreground"
                      title={tSig(p.signal_id)}
                    />
                  ) : null}
                  <span className="min-w-0 truncate font-medium">
                    {p.name ?? t('cards.playbook.untitled')}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('cards.playbook.frame_count', { count: p.frame_count })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
