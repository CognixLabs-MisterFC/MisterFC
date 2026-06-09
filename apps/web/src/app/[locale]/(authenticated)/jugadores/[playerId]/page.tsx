import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
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
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AssignTeamDialog } from '../_components/assign-team-dialog';
import { InviteTutorDialog } from './invite-tutor-dialog';
import { CancelInvitationButton } from '../../invitations/cancel-invitation-button';
import { SendMessageButton } from './send-message-button';
import { userCanMessageInClub } from '@/lib/messaging-permissions';
import { PlayerForm } from './player-form';
import { MedicalNotesForm } from './medical-notes-form';
import { PlayerPhotoUploader } from './player-photo-uploader';
import {
  PlayerNotesSection,
  type PlayerNoteItem,
} from './player-notes-section';
import { PlayerSeasonStats } from './player-season-stats';
import { PlayerDetailTabs, type PlayerTabKey } from './player-detail-tabs';

type Props = {
  params: Promise<{ locale: string; playerId: string }>;
  searchParams: Promise<{ season?: string; tab?: string }>;
};

const PLAYER_TABS: ReadonlyArray<PlayerTabKey> = ['info', 'stats', 'history'];

const ROLES_THAT_CAN_MANAGE: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

const PLAYER_PHOTO_TTL_SECONDS = 600; // 10 min

export default async function PlayerDetailPage({ params, searchParams }: Props) {
  const { locale, playerId } = await params;
  const { season: seasonParam, tab: tabParam } = await searchParams;
  setRequestLocale(locale);

  const activeTab: PlayerTabKey = PLAYER_TABS.includes(tabParam as PlayerTabKey)
    ? (tabParam as PlayerTabKey)
    : 'info';

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: player } = await supabase
    .from('players')
    .select(
      'id, club_id, first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, height_cm, weight_kg, origin, photo_url'
    )
    .eq('id', playerId)
    .maybeSingle();

  if (!player || player.club_id !== ctx.activeClub.club.id) notFound();

  const t = await getTranslations('jugadores');

  const canManage = ROLES_THAT_CAN_MANAGE.includes(ctx.activeClub.role);
  // canMessage considera además team_staff.staff_role (un ayudante club que
  // es principal via team_staff debe poder mensajear). Patrón calcado de
  // PR #24 (4f3bf39) para canManage de convocatorias.
  const canMessage = await userCanMessageInClub(supabase, ctx);

  // Visibilidad de medical_notes: helper SQL es la autoridad
  const { data: canSeeMedical } = await supabase.rpc(
    'user_can_see_player_medical',
    { p_player_id: player.id }
  );

  let medicalNotes: string | null = null;
  if (canSeeMedical) {
    const { data: row } = await supabase
      .from('players')
      .select('medical_notes')
      .eq('id', player.id)
      .maybeSingle();
    medicalNotes = row?.medical_notes ?? null;
  }

  // F7 mejora — Notas por jugador (solo cuerpo técnico). El helper SQL es la
  // autoridad (cuerpo técnico del jugador + admin/coord; NO familia).
  const { data: canSeeNotes } = await supabase.rpc(
    'user_can_access_player_notes',
    { p_player_id: player.id },
  );
  let playerNotes: PlayerNoteItem[] = [];
  if (canSeeNotes) {
    const { data: noteRows } = await supabase
      .from('player_notes')
      .select(
        'id, note, created_at, profiles!player_notes_author_profile_id_fkey(full_name)',
      )
      .eq('player_id', player.id)
      .order('created_at', { ascending: false });
    type NoteShape = {
      id: string;
      note: string;
      created_at: string;
      profiles: { full_name: string | null } | null;
    };
    playerNotes = (noteRows ?? []).map((r) => {
      const n = r as unknown as NoteShape;
      return {
        id: n.id,
        note: n.note,
        createdAt: n.created_at,
        authorName: n.profiles?.full_name ?? null,
      };
    });
  }

  // Signed URL para la foto actual (server side, TTL corto)
  let photoSignedUrl: string | null = null;
  if (player.photo_url) {
    const { data } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(player.photo_url, PLAYER_PHOTO_TTL_SECONDS);
    photoSignedUrl = data?.signedUrl ?? null;
  }

  // Trayectoria (F2.5). Rework A (A2): el embed trae teams.season (la temporada
  // vive ya en el equipo) además de la categoría (cuyo name/season aún usa el
  // display de la pestaña Trayectoria — su migración es A3).
  const { data: history } = await supabase
    .from('team_members')
    .select(
      'id, joined_at, left_at, dorsal_in_team, position_in_team, teams!inner(name, season, categories!inner(name, season))'
    )
    .eq('player_id', player.id)
    .order('joined_at', { ascending: false });

  // F9.1 — Stats agregadas por temporada (vista staff). Las temporadas del selector
  // salen de la trayectoria (Rework A: team.season); la temporada por defecto es la
  // del equipo activo (o la más reciente). La RLS de match_player_stats recorta.
  type HistTeam = {
    name: string;
    season: string;
    categories: { name: string; season: string };
  } | null;
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

  let aggregatedStats = sumMatchStats([]);
  if (activeSeason) {
    // Acotar por temporada vía team.season (Rework A: la temporada vive en el
    // equipo; match_player_stats.team_id es el del partido; el embed !inner filtra
    // las filas por esa temporada).
    const { data: statRows } = await supabase
      .from('match_player_stats')
      .select(
        'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)'
      )
      .eq('player_id', player.id)
      .eq('teams.season', activeSeason);
    aggregatedStats = sumMatchStats(
      (statRows ?? []) as unknown as MatchStatRow[]
    );
  }

  // F9.2 — Ratios derivados (puro, sobre los agregados) + desglose de asistencia
  // a entrenos de la temporada (query directa; bucket de ADR-0007 en core). La
  // RLS de training_attendance ya recorta la lectura.
  const ratios = derivedRatios(aggregatedStats);
  let attendance = attendanceBreakdown([]);
  if (activeSeason) {
    const { data: attRows } = await supabase
      .from('training_attendance')
      .select('code, events!inner(type, teams!inner(season))')
      .eq('player_id', player.id)
      .eq('events.type', 'training')
      .eq('events.teams.season', activeSeason);
    attendance = attendanceBreakdown(
      (attRows ?? []) as unknown as AttendanceRow[]
    );
  }

  // F9.3 — Evolución de la valoración: los partidos de la temporada (X = fecha),
  // con la nota individual (evaluations) y, como contexto, la colectiva
  // (team_evaluations) de esos mismos eventos. Sin nota → hueco (null), no 0.
  let evolution: RatingTimelinePoint[] = [];
  if (activeSeason) {
    const { data: matchRows } = await supabase
      .from('match_player_stats')
      .select(
        'event_id, events!inner(starts_at, opponent_name, title), teams!inner(season)'
      )
      .eq('player_id', player.id)
      .eq('teams.season', activeSeason);
    type MatchRow = {
      event_id: string;
      events: { starts_at: string; opponent_name: string | null; title: string };
    };
    const matches = (matchRows ?? []) as unknown as MatchRow[];
    if (matches.length > 0) {
      const eventIds = matches.map((m) => m.event_id);
      const [{ data: evalRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('evaluations')
          .select('event_id, rating')
          .eq('player_id', player.id)
          .in('event_id', eventIds),
        supabase
          .from('team_evaluations')
          .select('event_id, rating')
          .in('event_id', eventIds),
      ]);
      const ind = new Map<string, number | null>();
      for (const r of (evalRows ?? []) as Array<{
        event_id: string;
        rating: number | null;
      }>)
        ind.set(r.event_id, r.rating);
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
          rating: ind.get(m.event_id) ?? null,
          teamRating: team.get(m.event_id) ?? null,
        }))
      );
    }
  }

  // Familia: cuentas vinculadas + invitaciones pendientes (F2.4)
  const { data: linkedAccounts } = await supabase
    .from('player_accounts')
    .select('id, relation, profiles!inner(full_name)')
    .eq('player_id', player.id);

  const { data: pendingInvites } = await supabase
    .from('invitations')
    .select('id, email, player_relation, expires_at')
    .eq('player_id', player.id)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());

  // Equipos del club para el dialog de asignación
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, category_id, categories!inner(club_id)')
    .eq('categories.club_id', player.club_id);
  const teamsForDialog = (teamRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  const hasActiveAssignment = (history ?? []).some((h) => h.left_at === null);
  const fullName = `${player.first_name} ${player.last_name}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/jugadores">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_list')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <PlayerPhotoUploader
          playerId={player.id}
          initialPath={player.photo_url}
          initialSignedUrl={photoSignedUrl}
          fallback={fullName.slice(0, 2).toUpperCase()}
          canManage={canManage}
          labels={{
            change: t('photo.change'),
            remove: t('photo.remove'),
            hint: t('photo.hint'),
            errors: {
              mime: t('photo.errors.mime'),
              too_large: t('photo.errors.too_large'),
              empty: t('photo.errors.empty'),
              upload_failed: t('photo.errors.upload_failed'),
              remove_failed: t('photo.errors.remove_failed'),
            },
          }}
        />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{fullName}</h1>
          {player.dorsal != null && (
            <p className="text-sm text-muted-foreground">
              {t('field.dorsal')} #{player.dorsal}
            </p>
          )}
          {canMessage && (
            <div className="mt-1">
              <SendMessageButton locale={locale} playerId={player.id} />
            </div>
          )}
        </div>
      </div>

      <PlayerDetailTabs
        initialTab={activeTab}
        labels={{
          info: t('tabs.info'),
          stats: t('tabs.stats'),
          history: t('tabs.history'),
        }}
        info={
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t('section.basic_data')}</CardTitle>
              </CardHeader>
              <CardContent>
                <PlayerForm
                  playerId={player.id}
                  initial={player}
                  canEdit={canManage}
                />
              </CardContent>
            </Card>

            {canSeeMedical && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('section.medical')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <MedicalNotesForm
                    playerId={player.id}
                    initial={medicalNotes}
                    canEdit={canManage}
                  />
                </CardContent>
              </Card>
            )}

            {canSeeNotes && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('notes.section')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <PlayerNotesSection
                    playerId={player.id}
                    notes={playerNotes}
                    locale={locale}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <CardTitle>{t('section.family')}</CardTitle>
                {canManage && (
                  <InviteTutorDialog
                    locale={locale}
                    playerId={player.id}
                    playerName={fullName}
                  />
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {(linkedAccounts ?? []).length === 0 &&
                (pendingInvites ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('family.empty')}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {(linkedAccounts ?? []).map((acc) => {
                      const profObj = (acc.profiles ?? null) as
                        | { full_name: string | null }
                        | null;
                      const name = profObj?.full_name ?? '—';
                      return (
                        <li
                          key={acc.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{name}</span>
                            <span className="text-xs text-muted-foreground">
                              {t(`family.relation.${acc.relation}`)}
                            </span>
                          </div>
                          <span className="text-xs text-misterfc-green">
                            {t('family.linked')}
                          </span>
                        </li>
                      );
                    })}
                    {(pendingInvites ?? []).map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{inv.email}</span>
                          <span className="text-xs text-muted-foreground">
                            {inv.player_relation
                              ? t(`family.relation.${inv.player_relation}`)
                              : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {t('family.pending')}
                          </span>
                          {canManage && (
                            <CancelInvitationButton
                              locale={locale}
                              invitationId={inv.id}
                              email={inv.email}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        }
        stats={
          <Card>
            <CardHeader>
              <CardTitle>{t('section.season_stats')}</CardTitle>
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
        }
        history={
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <CardTitle>{t('section.history')}</CardTitle>
              {canManage && teamsForDialog.length > 0 && (
                <AssignTeamDialog
                  playerId={player.id}
                  teams={teamsForDialog}
                  hasActiveAssignment={hasActiveAssignment}
                />
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {(history ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('history.empty')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {(history ?? []).map((h) => {
                    // teams llega como objeto plano (FK con !inner) — el cliente
                    // de Supabase lo tipa como array, hacemos cast seguro.
                    const teamObj = (h.teams ?? null) as
                      | {
                          name: string;
                          categories: { name: string; season: string };
                        }
                      | null;
                    const teamName = teamObj?.name ?? '—';
                    const catName = teamObj?.categories?.name ?? '';
                    const season = teamObj?.categories?.season ?? '';
                    const isActive = h.left_at === null;
                    return (
                      <li
                        key={h.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{teamName}</span>
                          <span className="text-xs text-muted-foreground">
                            {catName}
                            {season ? ` · ${season}` : ''}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {h.joined_at}
                          {h.left_at
                            ? ` → ${h.left_at}`
                            : ` · ${t('history.active')}`}
                          {isActive && (
                            <span className="ml-1 text-misterfc-green">●</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}
