import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LineChart } from 'lucide-react';
import {
  createSupabaseServerClient,
  sumMatchStats,
  derivedRatios,
  attendanceBreakdown,
  ratingTimeline,
  type MatchStatRow,
  type AttendanceRow,
  type RatingTimelinePoint,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlayerSeasonStats } from '../jugadores/[playerId]/player-season-stats';
import { PlayerSelector } from './player-selector';
import {
  PlayerEvaluationsDetail,
  type MatchEvaluation,
} from './player-evaluations-detail';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string; season?: string }>;
};

/**
 * F9.5 — Vista jugador/familia del expediente deportivo (`/mi-ficha`).
 *
 * Resuelve el/los jugador(es) de la cuenta vía `player_accounts` (un usuario puede
 * ser cuenta de varios jugadores → selector). Reutiliza los bloques objetivos de
 * 9.1/9.2/9.3 (`PlayerSeasonStats`: totales + ratios + asistencia + gráfico de
 * evolución) y añade el bloque de valoraciones (rating + comentario VISIBLE + MVP
 * + colectiva).
 *
 * Matriz de visibilidad (spec 9.0 §3):
 *  - SIEMPRE (objetivo propio, 🔒 D9-1/D9-2, sin flag): stats, ratios, asistencia.
 *    Las stats las habilita la policy nueva `match_player_stats_select_player`.
 *  - SOLO con `club_settings.evaluations_player_visibility` ON (subjetivo): la
 *    evolución (la RLS de F8 deja `evaluations`/`team_evaluations` en 0 con flag
 *    OFF → el chart se auto-oculta) y el bloque de valoraciones (se renderiza solo
 *    si la query devolvió filas).
 *  - NUNCA: `evaluation_private_notes` ni `player_notes` — no se consultan aquí.
 */
export default async function MiFichaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { player: playerParam, season: seasonParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo jugador/familia (comparten el rol `jugador`). El staff usa /jugadores.
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_ficha');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Jugadores vinculados a la cuenta (vía player_accounts) en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select(
      'player_id, players!inner(id, club_id, first_name, last_name)'
    )
    .eq('profile_id', ctx.user.id);
  type PA = {
    player_id: string;
    players: {
      id: string;
      club_id: string;
      first_name: string;
      last_name: string | null;
    };
  };
  const myPlayers = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === ctx.activeClub.club.id)
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
    }));

  if (myPlayers.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <LineChart className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_player')}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2) Jugador activo: query param o el primero. (length > 0 garantizado.)
  const activePlayer =
    myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0]!;
  const playerId = activePlayer.id;

  // 3) Temporadas de la trayectoria del jugador → selector + default.
  //    Rework A (A2): la temporada vive en el equipo (teams.season).
  const { data: history } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(season)')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  type HistTeam = { season: string } | null;
  const seasonsSet = new Set<string>();
  let activeSeasonFromHistory: string | null = null;
  for (const h of history ?? []) {
    const tm = (h.teams ?? null) as HistTeam;
    const s = tm?.season;
    if (s) {
      seasonsSet.add(s);
      if (h.left_at === null) activeSeasonFromHistory = s;
    }
  }
  const seasons = Array.from(seasonsSet).sort((a, b) => b.localeCompare(a));
  const activeSeason =
    (seasonParam && seasons.includes(seasonParam) ? seasonParam : null) ??
    activeSeasonFromHistory ??
    seasons[0] ??
    null;

  // 4) Stats agregadas (SIEMPRE — policy match_player_stats_select_player).
  let aggregatedStats = sumMatchStats([]);
  if (activeSeason) {
    const { data: statRows } = await supabase
      .from('match_player_stats')
      .select(
        'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)'
      )
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    aggregatedStats = sumMatchStats(
      (statRows ?? []) as unknown as MatchStatRow[]
    );
  }

  // 5) Ratios (puro) + asistencia (SIEMPRE — D9-2; query filtra al jugador).
  const ratios = derivedRatios(aggregatedStats);
  let attendance = attendanceBreakdown([]);
  if (activeSeason) {
    const { data: attRows } = await supabase
      .from('training_attendance')
      .select('code, events!inner(type, teams!inner(season))')
      .eq('player_id', playerId)
      .eq('events.type', 'training')
      .eq('events.teams.season', activeSeason);
    attendance = attendanceBreakdown(
      (attRows ?? []) as unknown as AttendanceRow[]
    );
  }

  // 6) Evolución (SOLO flag ON — la RLS de F8 deja eval/team_eval en 0 con OFF) +
  //    detalle de valoraciones (rating + comentario VISIBLE + MVP + colectiva).
  let evolution: RatingTimelinePoint[] = [];
  let evaluationItems: MatchEvaluation[] = [];
  if (activeSeason) {
    const { data: matchRows } = await supabase
      .from('match_player_stats')
      .select(
        'event_id, events!inner(starts_at, opponent_name, title), teams!inner(season)'
      )
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    type MatchRow = {
      event_id: string;
      events: {
        starts_at: string;
        opponent_name: string | null;
        title: string;
      };
    };
    const matches = (matchRows ?? []) as unknown as MatchRow[];
    if (matches.length > 0) {
      const eventIds = matches.map((m) => m.event_id);
      const [{ data: evalRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('evaluations')
          .select('event_id, rating, comment, is_mvp')
          .eq('player_id', playerId)
          .in('event_id', eventIds),
        supabase
          .from('team_evaluations')
          .select('event_id, rating')
          .in('event_id', eventIds),
      ]);
      type EvalRow = {
        event_id: string;
        rating: number | null;
        comment: string | null;
        is_mvp: boolean;
      };
      const ind = new Map<string, EvalRow>();
      for (const r of (evalRows ?? []) as EvalRow[]) ind.set(r.event_id, r);
      const team = new Map<string, number | null>();
      for (const r of (teamRows ?? []) as Array<{
        event_id: string;
        rating: number | null;
      }>)
        team.set(r.event_id, r.rating);

      evolution = ratingTimeline(
        matches.map((m) => ({
          eventId: m.event_id,
          startsAt: m.events.starts_at,
          label: m.events.opponent_name ?? m.events.title,
          rating: ind.get(m.event_id)?.rating ?? null,
          teamRating: team.get(m.event_id) ?? null,
        }))
      );

      // Detalle de valoraciones: solo los partidos con valoración individual
      // legible (flag ON). Con flag OFF `ind` está vacío → lista vacía → no se
      // pinta la sección.
      evaluationItems = matches
        .filter((m) => ind.has(m.event_id))
        .map((m) => {
          const e = ind.get(m.event_id)!;
          return {
            eventId: m.event_id,
            startsAt: m.events.starts_at,
            label: m.events.opponent_name ?? m.events.title,
            rating: e.rating,
            isMvp: e.is_mvp,
            comment: e.comment,
            teamRating: team.get(m.event_id) ?? null,
          };
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <LineChart className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {myPlayers.length > 1 ? t('subtitle_many') : t('subtitle_one')}
        </p>
      </div>

      {myPlayers.length > 1 && (
        <PlayerSelector
          locale={locale}
          activePlayerId={playerId}
          players={myPlayers}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {myPlayers.length > 1 ? activePlayer.name : t('section.stats')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerSeasonStats
            stats={aggregatedStats}
            ratios={ratios}
            attendance={attendance}
            timeline={evolution}
            seasons={seasons}
            activeSeason={activeSeason}
          />
        </CardContent>
      </Card>

      {evaluationItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('section.evaluations')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlayerEvaluationsDetail items={evaluationItems} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
