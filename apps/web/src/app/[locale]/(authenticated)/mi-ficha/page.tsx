import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Download, LineChart } from 'lucide-react';
import {
  createSupabaseServerClient,
  sumMatchStats,
  splitMatchStatsByType,
  derivedRatios,
  attendanceBreakdown,
  ratingTimeline,
  PLAYER_POSITIONS,
  type PlayerPosition,
  type MatchStatRow,
  type MatchStatRowTyped,
  type MatchStatsByType,
  type AttendanceRow,
  type RatingTimelinePoint,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadPlayerCareer } from '@/lib/player-career';
import { loadPlayerBadges } from '@/lib/player-badges';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlayerSeasonStats } from '../jugadores/[playerId]/player-season-stats';
import { PlayerBadges } from '../jugadores/[playerId]/player-badges';
import { FichaHeader } from '../jugadores/[playerId]/informes/_components/ficha-header';
import { PlayerPhotoUploader } from '../jugadores/[playerId]/player-photo-uploader';
import { PlayerSelector } from './player-selector';
import {
  PlayerEvaluationsDetail,
  type MatchEvaluation,
} from './player-evaluations-detail';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string; season?: string }>;
};

const PHOTO_TTL = 3600;

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/**
 * F9.5 — Vista jugador/familia del expediente deportivo (`/mi-ficha`).
 *
 * Resuelve el/los jugador(es) de la cuenta vía `player_accounts` (un usuario puede
 * ser cuenta de varios jugadores → selector). Reutiliza los bloques objetivos de
 * 9.1/9.2/9.3 (`PlayerSeasonStats`: totales + ratios + asistencia + gráfico de
 * evolución) y añade el bloque de valoraciones (rating + comentario VISIBLE + MVP
 * + colectiva).
 *
 * F13.10d — la cabecera de identidad reusa la del informe (`FichaHeader`): foto +
 * dorsal + edad/pie/posición + mini-campo. Los INFORMES DE DESARROLLO viven en su
 * propia ruta (`/mi-informe`), enlazada desde el menú lateral (solo jugador).
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

  // 2b) Datos de identidad del jugador para la cabecera (reusa la del informe).
  const { data: playerRow } = await supabase
    .from('players')
    .select(
      'first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url'
    )
    .eq('id', playerId)
    .maybeSingle();
  let headerPhotoUrl: string | null = null;
  if (playerRow?.photo_url) {
    const { data: signed } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(playerRow.photo_url, PHOTO_TTL);
    headerPhotoUrl = signed?.signedUrl ?? null;
  }
  const headerPrimaryPos = (PLAYER_POSITIONS as readonly string[]).includes(
    playerRow?.position_main ?? ''
  )
    ? (playerRow!.position_main as PlayerPosition)
    : null;

  // F14-3b — la foto del hijo la gestiona SOLO el tutor vinculado (parent/guardian),
  // de forma continua desde su ficha. El propio jugador (relation='self') NO.
  const { data: isTutorOfPlayer } = await supabase.rpc(
    'user_is_tutor_of_player',
    { p_player_id: playerId }
  );
  const tJugadores = await getTranslations('jugadores');

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
  // F9B-3 — desglose por tipo (modo Temporada) con el mismo helper que el informe
  // (splitMatchStatsByType, F9B-1); sin cálculo nuevo, solo el join events.
  let aggregatedStats = sumMatchStats([]);
  let matchStatsByType: MatchStatsByType = splitMatchStatsByType([]);
  if (activeSeason) {
    const { data: statRows } = await supabase
      .from('match_player_stats')
      .select(
        'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, events!inner(type, tournament_id), teams!inner(season)'
      )
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    type StatRowRaw = MatchStatRow & {
      events: { type: string; tournament_id: string | null };
    };
    const typedRows: MatchStatRowTyped[] = (
      (statRows ?? []) as unknown as StatRowRaw[]
    ).map((r) => ({
      ...r,
      eventType: r.events?.type ?? '',
      tournamentId: r.events?.tournament_id ?? null,
    }));
    matchStatsByType = splitMatchStatsByType(typedRows);
    aggregatedStats = matchStatsByType.total;
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

  // 7) Carrera multi-temporada (9.B-2). Mismo helper que la vista staff; la RLS
  //    de F8 deja el rating por temporada en null con el flag de visibilidad OFF
  //    (las stats SIEMPRE se ven — D9-1). Una query, agrupado en core.
  const career = await loadPlayerCareer(supabase, playerId);

  // 8) Badges (logros). Mismo helper que la vista staff; showRating se computa
  //    en servidor desde club_settings (D5: sin flag, no llegan las de rating).
  const badges = await loadPlayerBadges(supabase, {
    playerId,
    clubId: ctx.activeClub.club.id,
    careerMatches: career.totals.stats.matches,
  });
  const tBadges = await getTranslations('badges');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <LineChart className="size-6" aria-hidden />
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {myPlayers.length > 1 ? t('subtitle_many') : t('subtitle_one')}
          </p>
        </div>
        {/* PDF del expediente (9.B-6): mismo Route Handler del jugador, RLS
            heredada (la familia solo ve lo de su jugador, sin médicas/notas). */}
        <Button asChild variant="outline" size="sm" className="gap-2">
          <a href={`/${locale}/jugadores/${playerId}/pdf`}>
            <Download className="size-4" aria-hidden />
            <span>{t('export_pdf')}</span>
          </a>
        </Button>
      </div>

      {myPlayers.length > 1 && (
        <PlayerSelector
          locale={locale}
          activePlayerId={playerId}
          players={myPlayers}
        />
      )}

      {/* Cabecera de identidad (reusa la del informe de desarrollo). */}
      <Card>
        <CardContent className="pt-6">
          <FichaHeader
            data={{
              fullName: activePlayer.name,
              initials:
                (playerRow?.first_name?.[0] ?? '') +
                (playerRow?.last_name?.[0] ?? ''),
              photoUrl: headerPhotoUrl,
              dorsal: playerRow?.dorsal ?? null,
              age: ageFromDob(playerRow?.date_of_birth ?? null),
              primaryPos: headerPrimaryPos,
              secondaryPos: (playerRow?.positions_secondary ?? []) as string[],
              foot: playerRow?.foot ?? null,
              subtitle: activeSeason,
            }}
          />
        </CardContent>
      </Card>

      {/* F14-3b — Gestión de la foto: SOLO el tutor vinculado (parent/guardian). */}
      {isTutorOfPlayer && (
        <Card>
          <CardHeader>
            <CardTitle>{t('section.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlayerPhotoUploader
              playerId={playerId}
              initialPath={playerRow?.photo_url ?? null}
              initialSignedUrl={headerPhotoUrl}
              fallback={
                (playerRow?.first_name?.[0] ?? '') +
                (playerRow?.last_name?.[0] ?? '')
              }
              canManage
              labels={{
                change: tJugadores('photo.change'),
                remove: tJugadores('photo.remove'),
                hint: tJugadores('photo.hint'),
                errors: {
                  mime: tJugadores('photo.errors.mime'),
                  too_large: tJugadores('photo.errors.too_large'),
                  empty: tJugadores('photo.errors.empty'),
                  upload_failed: tJugadores('photo.errors.upload_failed'),
                  remove_failed: tJugadores('photo.errors.remove_failed'),
                },
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('section.stats')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerSeasonStats
            stats={aggregatedStats}
            statsByType={matchStatsByType}
            ratios={ratios}
            attendance={attendance}
            timeline={evolution}
            seasons={seasons}
            activeSeason={activeSeason}
            career={career}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tBadges('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerBadges badges={badges} />
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
