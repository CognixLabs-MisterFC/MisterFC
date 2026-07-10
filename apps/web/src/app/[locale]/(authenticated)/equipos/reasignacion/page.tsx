import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarClock, Users } from 'lucide-react';
import {
  createSupabaseServerClient,
  formatPlayerName,
  categoryKindOrdinal,
} from '@misterfc/core';
import { Link } from '@/i18n/navigation';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TeamMappingCard,
  type MappingDestTeam,
  type MappingPlayer,
} from './team-mapping-card';
import {
  PendingPlayersPanel,
  type PendingPlayer,
} from './pending-players-panel';

type Props = { params: Promise<{ locale: string }> };

type TeamRow = {
  id: string;
  name: string;
  season: string;
  categories: { name: string; kind: string | null };
};
type MemberRow = {
  team_id: string;
  player_id: string;
  players: {
    first_name: string;
    last_name: string | null;
    left_club_at: string | null;
    erased_at: string | null;
  };
};

export default async function ReasignacionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo admin_club: la colocación en bloque es una operación de rollover.
  if (ctx.activeClub.role !== 'admin_club') redirect(`/${locale}/equipos`);

  const t = await getTranslations('equipos');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  // La upcoming en preparación (si no hay, el asistente no aplica todavía).
  const { data: upcomingRow } = await supabase
    .from('seasons')
    .select('label')
    .eq('club_id', clubId)
    .eq('status', 'upcoming')
    .maybeSingle();
  const upcomingSeason = (upcomingRow?.label as string | undefined) ?? null;

  // Equipos de la activa (origen) + de la upcoming (destino), en una sola query.
  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, season, categories!inner(name, kind)')
    .eq('club_id', clubId)
    .in('season', upcomingSeason ? [activeSeason, upcomingSeason] : [activeSeason])
    .order('name', { ascending: true });
  const teams = (teamsData ?? []) as unknown as TeamRow[];

  const byOrdinal = (a: TeamRow, b: TeamRow) =>
    categoryKindOrdinal(a.categories.kind) -
      categoryKindOrdinal(b.categories.kind) ||
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

  const sourceTeams = teams
    .filter((tm) => tm.season === activeSeason)
    .sort(byOrdinal);
  const destTeamRows = teams
    .filter((tm) => tm.season === upcomingSeason)
    .sort(byOrdinal);
  const destTeams: MappingDestTeam[] = destTeamRows.map((d) => ({
    id: d.id,
    name: d.name,
    categoryName: d.categories.name,
  }));

  // Miembros activos: tanto de los equipos origen (checklist) como de los
  // destino (para marcar "ya colocado"). left_at IS NULL = roster time-aware.
  const allTeamIds = teams.map((tm) => tm.id);
  const { data: memberData } = allTeamIds.length
    ? await supabase
        .from('team_members')
        .select('team_id, player_id, players!inner(first_name, last_name, left_club_at, erased_at)')
        .in('team_id', allTeamIds)
        .is('left_at', null)
    : { data: [] as MemberRow[] };
  // F14-7: los jugadores SUPRIMIDOS se excluyen del roster y de los pendientes.
  const members = ((memberData ?? []) as unknown as MemberRow[]).filter(
    (m) => m.players.erased_at == null
  );

  // Para cada jugador, en qué equipos de la upcoming está colocado (membresía
  // abierta). Permite a la tarjeta mostrar "colocar" o "quitar" según el destino.
  const destTeamIdSet = new Set(destTeamRows.map((d) => d.id));
  const placedTeamsByPlayer = new Map<string, string[]>();
  for (const m of members) {
    if (!destTeamIdSet.has(m.team_id)) continue;
    const list = placedTeamsByPlayer.get(m.player_id) ?? [];
    list.push(m.team_id);
    placedTeamsByPlayer.set(m.player_id, list);
  }

  // Roster por equipo origen.
  const rosterBySource = new Map<string, MappingPlayer[]>();
  for (const m of members) {
    if (destTeamIdSet.has(m.team_id)) continue; // solo equipos origen
    const list = rosterBySource.get(m.team_id) ?? [];
    list.push({
      id: m.player_id,
      name: formatPlayerName(m.players.first_name, m.players.last_name),
      placedTeamIds: placedTeamsByPlayer.get(m.player_id) ?? [],
    });
    rosterBySource.set(m.team_id, list);
  }
  for (const list of rosterBySource.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  // Destino por defecto: el equipo upcoming con el mismo nombre, si existe.
  const destByName = new Map(destTeams.map((d) => [d.name.toLowerCase(), d.id]));

  // C11b — PENDIENTES: jugadores de la temporada activa (en equipos origen),
  // activos en el club (NO baja) y aún sin colocar en NINGÚN equipo de la
  // upcoming. Derivado, sin estado nuevo.
  const sourceTeamName = new Map(sourceTeams.map((s) => [s.id, s.name]));
  const placedPlayerIds = new Set(placedTeamsByPlayer.keys());
  const pendingMap = new Map<string, PendingPlayer>();
  for (const m of members) {
    if (!sourceTeamName.has(m.team_id)) continue; // solo equipos origen
    if (placedPlayerIds.has(m.player_id)) continue; // ya colocado en upcoming
    if (m.players.left_club_at != null) continue; // de baja → no es pendiente
    if (pendingMap.has(m.player_id)) continue;
    pendingMap.set(m.player_id, {
      id: m.player_id,
      name: formatPlayerName(m.players.first_name, m.players.last_name),
      sourceTeam: sourceTeamName.get(m.team_id) ?? '',
    });
  }
  const pendingPlayers = [...pendingMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href="/equipos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('reassign.back')}</span>
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">
          {t('reassign.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('reassign.subtitle')}</p>
      </div>

      {!upcomingSeason ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {t('reassign.no_upcoming')}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/equipos">{t('reassign.back')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
            role="status"
          >
            {t('reassign.banner', {
              active: activeSeason,
              upcoming: upcomingSeason,
            })}
          </div>

          {destTeams.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Users className="size-10 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  {t('reassign.no_dest_teams')}
                </p>
              </CardContent>
            </Card>
          )}

          {destTeams.length > 0 && sourceTeams.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Users className="size-10 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  {t('reassign.no_source_teams', { season: activeSeason })}
                </p>
              </CardContent>
            </Card>
          )}

          {destTeams.length > 0 && sourceTeams.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
              <div className="flex flex-col gap-4">
                {sourceTeams.map((src) => (
                  <TeamMappingCard
                    key={src.id}
                    sourceTeam={{
                      id: src.id,
                      name: src.name,
                      categoryName: src.categories.name,
                    }}
                    players={rosterBySource.get(src.id) ?? []}
                    destTeams={destTeams}
                    defaultDestId={
                      destByName.get(src.name.toLowerCase()) ?? null
                    }
                  />
                ))}
              </div>
              <PendingPlayersPanel
                players={pendingPlayers}
                destTeams={destTeams}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
