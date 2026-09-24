/**
 * D2-1 — LISTAS club-wide de las colas de eventos del inicio de dirección (SOLO
 * LECTURA). Espejan, fila a fila, los MISMOS conteos que `home-counts.ts` calcula
 * para los badges del inicio (`getDireccionHomeCountsFromClient`): aquí, en vez del
 * número, se devuelven las filas enriquecidas (título, fecha, equipo) para pintar la
 * lista y cablear cada fila a su detalle read-only de dirección. Los helpers de
 * conteo de `home-counts.ts` NO se tocan (el badge del inicio sigue igual).
 *
 * Mismas tablas y filas que los conteos que YA corren hoy para el director (events,
 * sessions, training_attendance, match_callup_meta, teams): solo se piden más
 * columnas de filas ya legibles. Sin superficie RLS nueva. Club-wide por `clubId`;
 * nada atado a team_staff/membership. Las ACCIONES quedan fuera (solo consulta).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MATCH_SURFACE_TYPES } from '../events/types';
import {
  invitationDeliveryOutcome,
  type InvitationDeliveryOutcome,
} from './delivery-status';
import {
  reportStatus,
  DEVELOPMENT_REPORT_CATALOG,
} from '../development-report/development-report';

type DbClient = SupabaseClient<Database>;

// Mismas ventanas que `home-counts.ts` (paridad con los conteos del inicio).
const TRAINING_WINDOW_HOURS = 48;
const ATTENDANCE_LOOKBACK_HOURS = 72;
const CALLUP_HORIZON_DAYS = 60;

/**
 * Fila de una cola de eventos pendientes. Lleva justo lo que `directionEventTarget`
 * necesita para enrutar (`id`, `type`, `title`, `starts_at`, `location_name`,
 * `has_session`) más lo que pinta la fila (`opponent_name`, `team_name`,
 * `team_color`).
 */
export type DireccionPendingEvent = {
  id: string;
  type: string;
  title: string;
  starts_at: string;
  location_name: string | null;
  opponent_name: string | null;
  team_name: string | null;
  team_color: string | null;
  has_session: boolean;
};

/** Join `teams(name, color)` de PostgREST: objeto, array o null (el generador no lo estrecha). */
type RawTeam = { name: string; color: string } | { name: string; color: string }[] | null;

function teamOf(raw: unknown): { name: string | null; color: string | null } {
  const team = raw as RawTeam;
  const t = Array.isArray(team) ? (team[0] ?? null) : team;
  return { name: t?.name ?? null, color: t?.color ?? null };
}

/** Set de event_ids con sesión real (no plantilla) vinculada, entre los dados. */
async function plannedEventIds(
  supabase: DbClient,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', eventIds)
    .eq('is_template', false);
  return new Set(
    (data ?? [])
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => id != null)
  );
}

/**
 * Entrenamientos de equipo (<48h futuros) SIN sesión vinculada. Espeja
 * `countTrainingsWithoutSession`; `has_session` es siempre false (por definición).
 * Detalle: `directionEventTarget` → `/direction/entrenamiento`.
 */
export async function listTrainingsWithoutSessionFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + TRAINING_WINDOW_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id, type, title, starts_at, location_name, teams(name, color)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gt('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });

  const rows = evRows ?? [];
  const planned = await plannedEventIds(
    supabase,
    rows.map((e) => e.id as string)
  );
  return rows
    .filter((e) => !planned.has(e.id as string))
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id as string,
        type: e.type as string,
        title: (e.title as string) ?? '',
        starts_at: e.starts_at as string,
        location_name: (e.location_name as string | null) ?? null,
        opponent_name: null,
        team_name: name,
        team_color: color,
        has_session: false,
      };
    });
}

/**
 * Entrenamientos pasados (<72h) SIN ninguna fila de asistencia. Espeja
 * `countTrainingsWithoutAttendance`. Se calcula `has_session` para que
 * `directionEventTarget` lleve al visor de sesión (`/direction/sesion?eventId`, que
 * resuelve el id y cae al detalle de entreno si no) o, sin sesión, al detalle.
 */
export async function listPastTrainingsWithoutAttendanceFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const fromIso = new Date(
    Date.now() - ATTENDANCE_LOOKBACK_HOURS * 3_600_000
  ).toISOString();

  const { data: evRows } = await supabase
    .from('events')
    .select('id, type, title, starts_at, location_name, teams(name, color)')
    .eq('club_id', clubId)
    .eq('type', 'training')
    .is('cancelled_at', null)
    .or('approval_status.is.null,approval_status.eq.approved')
    .not('team_id', 'is', null)
    .gte('starts_at', fromIso)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending: false });

  const rows = evRows ?? [];
  const eventIds = rows.map((e) => e.id as string);
  if (eventIds.length === 0) return [];

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('event_id')
    .in('event_id', eventIds);
  const marked = new Set((attRows ?? []).map((r) => r.event_id as string));
  const planned = await plannedEventIds(supabase, eventIds);

  return rows
    .filter((e) => !marked.has(e.id as string))
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id as string,
        type: e.type as string,
        title: (e.title as string) ?? '',
        starts_at: e.starts_at as string,
        location_name: (e.location_name as string | null) ?? null,
        opponent_name: null,
        team_name: name,
        team_color: color,
        has_session: planned.has(e.id as string),
      };
    });
}

/**
 * Partidos (hasta +60d) SIN `match_callup_meta.published_at`. Espeja
 * `countPendingCallups` (mismos `MATCH_SURFACE_TYPES`). Detalle:
 * `directionEventTarget` → `/direction/convocatoria` read-only.
 */
export async function listPendingCallupsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionPendingEvent[]> {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(
    Date.now() + CALLUP_HORIZON_DAYS * 86_400_000
  ).toISOString();

  const { data } = await supabase
    .from('events')
    .select(
      'id, type, title, starts_at, opponent_name, teams(name, color), match_callup_meta(published_at)'
    )
    .eq('club_id', clubId)
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', nowIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });

  type Row = {
    id: string;
    type: string;
    title: string;
    starts_at: string;
    opponent_name: string | null;
    teams: unknown;
    match_callup_meta:
      | { published_at: string | null }
      | { published_at: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((e) => {
      const m = e.match_callup_meta;
      if (!m) return true;
      if (Array.isArray(m)) return m.length === 0 || !m[0]?.published_at;
      return !m.published_at;
    })
    .map((e) => {
      const { name, color } = teamOf(e.teams);
      return {
        id: e.id,
        type: e.type,
        title: e.title ?? '',
        starts_at: e.starts_at,
        location_name: null,
        opponent_name: e.opponent_name ?? null,
        team_name: name,
        team_color: color,
        has_session: false,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  D2-2 · Listas TERMINALES (sin detalle): invitaciones + progreso de informes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado de una invitación derivado de sus fechas (no hay columna `status`):
 *  · `accepted`  → `accepted_at` no nulo.
 *  · `expired`   → sin aceptar y `expires_at` ya pasó.
 *  · `pending`   → sin aceptar y aún vigente.
 */
export type DireccionInvitationStatus = 'pending' | 'accepted' | 'expired';

function invitationStatus(
  acceptedAt: string | null,
  expiresAt: string,
  nowMs: number
): DireccionInvitationStatus {
  if (acceptedAt != null) return 'accepted';
  return new Date(expiresAt).getTime() <= nowMs ? 'expired' : 'pending';
}

/** Fila del RESUMEN por equipo (D2-3 nivel 1). `teamId` null = fila "Sin equipo". */
export type DireccionTeamInvitationSummary = {
  teamId: string | null;
  team_name: string | null;
  team_color: string | null;
  sent: number;
  accepted: number;
  expired: number;
  pending: number;
  /**
   * A-3 — cuántas de ese equipo NO llegaron. Se cuenta aquí y no solo al entrar porque
   * este resumen es donde se mira «cuántos han aceptado y cuántos no»: un equipo con
   * tres rebotes tiene que verse sin abrirlo.
   *
   * NO se resta de las otras: una invitación que no llegó sigue estando Pendiente. Es
   * un corte distinto de las mismas filas, no una quinta categoría excluyente.
   */
  not_delivered: number;
};

/**
 * EL EQUIPO DE UNA INVITACION, resuelto AL PINTAR.
 *
 * Por que no sale de `invitations.team_id`: esa columna nacio para la invitacion de
 * STAFF —invitas a un entrenador A UN EQUIPO, y ahi el equipo es parte de lo que
 * invitas—. La invitacion de FAMILIA no lleva equipo y nunca lo llevo: el jugador esta
 * en `team_members`. Medido en produccion: 9 de 9 invitaciones con `player_id` tienen
 * `team_id` nulo, vengan del alta individual, del reenvio desde la ficha o del envio en
 * lote tras importar. Todas caian en "Sin equipo".
 *
 * Y NO se arregla copiando el equipo a la invitacion (decision de Jose): un dato copiado
 * se queda viejo en cuanto el crio cambia de equipo, y ademas habria que decidir que
 * hacer con las filas ya creadas. La pertenencia viva es la fuente de verdad, asi que se
 * lee de ahi cada vez.
 *
 * LA REGLA, en un solo sitio porque la usan los DOS niveles del listado (el resumen por
 * equipo y la lista de un equipo) y las dos apps. Escrita dos veces acabaria contando
 * una cosa en el resumen y otra al entrar.
 */
export function effectiveInvitationTeamId(
  inv: { team_id: string | null; player_id: string | null },
  teamByPlayer: ReadonlyMap<string, string>,
): string | null {
  // 1 · La invitacion de staff manda: el equipo es parte de lo que se invito.
  if (inv.team_id) return inv.team_id;
  // 2 · La de familia, por el equipo VIVO de su jugador en la temporada activa.
  if (inv.player_id) return teamByPlayer.get(inv.player_id) ?? null;
  // 3 · Lo demas —director, admin de club— no va atado a ningun equipo.
  return null;
}

/**
 * Equipo VIVO de cada jugador en la temporada activa.
 *
 * `left_at is null` no es un detalle: `team_members` guarda el historico y un traspaso
 * deja la fila vieja cerrada. Medido en produccion: 90 filas, 44 vivas, 44 jugadores
 * distintos — exactamente UNA pertenencia viva por jugador, en todas las temporadas.
 * Contar sin ese filtro hace aparecer jugadores en "dos equipos" que en realidad
 * cambiaron de equipo a mitad de temporada.
 *
 * Devuelve un Map y no una lista porque un jugador tiene UN equipo: si algun dia
 * hubiera dos, gana el primero que llegue y hay que venir aqui a decidir.
 */
async function activeTeamByPlayer(
  supabase: DbClient,
  clubId: string,
  seasonLabel: string,
  playerIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (playerIds.length === 0) return out;
  const { data } = await supabase
    .from('team_members')
    .select('player_id, team_id, teams!inner(season, categories!inner(club_id))')
    .in('player_id', playerIds as string[])
    .is('left_at', null)
    .eq('teams.season', seasonLabel)
    .eq('teams.categories.club_id', clubId);
  for (const r of (data ?? []) as Array<{ player_id: string; team_id: string }>) {
    if (!out.has(r.player_id)) out.set(r.player_id, r.team_id);
  }
  return out;
}

type InvAgg = {
  sent: number;
  accepted: number;
  expired: number;
  pending: number;
  not_delivered: number;
};
const emptyAgg = (): InvAgg => ({ sent: 0, accepted: 0, expired: 0, pending: 0, not_delivered: 0 });

/**
 * D2-3 nivel 1 — Resumen de invitaciones POR EQUIPO de la temporada activa (SOLO
 * CONSULTA, club-wide). Una fila por equipo de la temporada activa —INCLUIDOS los que
 * tienen 0 enviadas (decisión Jose: un equipo a 0 es justo lo que hay que ver, se le
 * olvidó invitar)— con el desglose completo enviadas/aceptadas/caducadas/pendientes.
 * Más una fila "Sin equipo" (teamId null) SOLO si hay invitaciones sin `team_id`.
 *
 * A diferencia del loader de D2-2, lee TODAS las invitaciones del club (no solo las
 * pendientes no caducadas): el desglose necesita aceptadas y caducadas. La RLS
 * `invitations_select_admin_or_invited` da al director todas las filas del club sin
 * filtro de estado. Equipos de la temporada activa con el mismo patrón que
 * `listTeamsReportProgressFromClient`. Orden: pendientes desc (a quién perseguir);
 * los de 0 pendientes (incluidos los de 0 enviadas) caen al final por nombre, y "Sin
 * equipo" queda tras los equipos con nombre a igualdad de pendientes.
 */
export async function listTeamInvitationSummariesFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionTeamInvitationSummary[]> {
  const nowMs = Date.now();

  // Equipos de la temporada activa (mismo patrón que reports-progress).
  const { data: season } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();

  let teams: Array<{ id: string; name: string; color: string | null }> = [];
  if (season) {
    const { data: teamRows } = await supabase
      .from('teams')
      .select('id, name, color, categories!inner(club_id)')
      .eq('season', season.label as string)
      .eq('categories.club_id', clubId);
    teams = ((teamRows ?? []) as unknown as Array<{
      id: string;
      name: string;
      color: string | null;
    }>).map((t) => ({ id: t.id, name: t.name, color: t.color ?? null }));
  }

  // TODAS las invitaciones del club (estados derivados de las fechas). Se pide tambien
  // `player_id`: el equipo de las de familia no esta en la fila, se resuelve debajo.
  const { data: invRows } = await supabase
    .from('invitations')
    // Una sola cadena LITERAL a proposito: PostgREST deduce los tipos leyendo este
    // texto, y partirlo con `+` lo deja en `GenericStringError[]`.
    .select(
      'team_id, player_id, accepted_at, expires_at, created_at, delivery_message_id, delivery_state, delivery_at',
    )
    .eq('club_id', clubId);

  const invitations = (invRows ?? []) as Array<{
    team_id: string | null;
    player_id: string | null;
    accepted_at: string | null;
    expires_at: string;
    created_at: string;
    delivery_message_id: string | null;
    delivery_state: string | null;
    delivery_at: string | null;
  }>;

  // Una sola consulta para todos los jugadores implicados, no una por fila.
  const teamByPlayer = season
    ? await activeTeamByPlayer(
        supabase,
        clubId,
        season.label as string,
        Array.from(
          new Set(
            invitations
              .filter((r) => !r.team_id && r.player_id)
              .map((r) => r.player_id as string),
          ),
        ),
      )
    : new Map<string, string>();

  const byTeam = new Map<string, InvAgg>();
  const noTeam = emptyAgg();
  for (const r of invitations) {
    const teamId = effectiveInvitationTeamId(r, teamByPlayer);
    const agg = teamId ? byTeam.get(teamId) ?? emptyAgg() : noTeam;
    agg.sent += 1;
    const st = invitationStatus(r.accepted_at, r.expires_at, nowMs);
    agg[st] += 1;
    // A-3 — corte aparte, no una quinta categoria: una que no llego sigue contando
    // ademas en pendientes o en caducadas, que es donde esta.
    if (invitationDeliveryOutcome(r, nowMs) === 'failed') agg.not_delivered += 1;
    if (teamId) byTeam.set(teamId, agg);
  }

  const rows: DireccionTeamInvitationSummary[] = teams.map((t) => {
    const a = byTeam.get(t.id) ?? emptyAgg();
    return { teamId: t.id, team_name: t.name, team_color: t.color, ...a };
  });
  if (noTeam.sent > 0) {
    rows.push({ teamId: null, team_name: null, team_color: null, ...noTeam });
  }

  // Pendientes desc; a igualdad, los equipos con nombre antes que "Sin equipo"; luego
  // por nombre. Los de 0 pendientes (incluidos 0 enviadas) caen al final por nombre.
  rows.sort(
    (a, b) =>
      b.pending - a.pending ||
      (a.teamId === null ? 1 : 0) - (b.teamId === null ? 1 : 0) ||
      (a.team_name ?? '').localeCompare(b.team_name ?? '')
  );
  return rows;
}

/** Fila del listado individual de UN equipo (D2-3 nivel 2, informativa, sin navegación). */
export type DireccionTeamInvitation = {
  id: string;
  email: string;
  role: string;
  status: DireccionInvitationStatus;
  /** Fecha relevante según estado: aceptación si aceptada, caducidad en otro caso. */
  date: string;
  /**
   * A-3 — ¿le llegó el correo? Va SEPARADO de `status` a propósito: son dos preguntas
   * distintas —¿la aceptaron? y ¿le llegó?— y una invitación puede estar Pendiente y
   * además no haber llegado. Metidas en un solo campo habría que elegir cuál se pierde.
   */
  delivery: InvitationDeliveryOutcome;
  /** El motivo que dio Resend, cuando lo hay. Es lo que hace accionable un «No llegó». */
  delivery_detail: string | null;
};

/**
 * D2-3 nivel 2 — TODAS las invitaciones de un equipo (o las que NO van atadas a equipo,
 * `teamId=null`), con su estado. NO solo las pendientes. El filtro por estado
 * (TODAS/PENDIENTES/CADUCADAS/ACEPTADAS) lo hace la pantalla en cliente (volumen por
 * equipo pequeño). Orden: pendientes primero (caducan antes → primero), luego caducadas
 * y aceptadas más recientes primero. RLS igual que el resumen (director club-wide).
 */
export async function listTeamInvitationsFromClient(
  supabase: DbClient,
  clubId: string,
  teamId: string | null
): Promise<DireccionTeamInvitation[]> {
  const nowMs = Date.now();

  // El filtro por equipo YA NO se hace en SQL. El equipo de una invitacion de familia
  // no esta en la fila —se resuelve con `effectiveInvitationTeamId`—, asi que un
  // `.eq('team_id', …)` dejaria fuera justo las que hay que ensenar. Se traen las del
  // club y se filtra en memoria; es el MISMO conjunto que ya lee el resumen de nivel 1
  // de esta misma pantalla, y el volumen por club es de decenas.
  const { data: season } = await supabase
    .from('seasons')
    .select('label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data } = await supabase
    .from('invitations')
    // Literal de una pieza, por lo mismo que arriba.
    .select(
      'id, email, role, team_id, player_id, accepted_at, expires_at, created_at, delivery_message_id, delivery_state, delivery_detail, delivery_at',
    )
    .eq('club_id', clubId);

  const all = (data ?? []) as Array<{
    id: string;
    email: string;
    role: string;
    team_id: string | null;
    player_id: string | null;
    accepted_at: string | null;
    expires_at: string;
    created_at: string;
    delivery_message_id: string | null;
    delivery_state: string | null;
    delivery_detail: string | null;
    delivery_at: string | null;
  }>;

  const teamByPlayer = season
    ? await activeTeamByPlayer(
        supabase,
        clubId,
        season.label as string,
        Array.from(
          new Set(
            all.filter((r) => !r.team_id && r.player_id).map((r) => r.player_id as string),
          ),
        ),
      )
    : new Map<string, string>();

  const rows: DireccionTeamInvitation[] = all
    .filter((r) => effectiveInvitationTeamId(r, teamByPlayer) === teamId)
    .map((r) => {
    const status = invitationStatus(r.accepted_at, r.expires_at, nowMs);
    const delivery = invitationDeliveryOutcome(r, nowMs);
    return {
      id: r.id,
      email: r.email,
      role: r.role,
      status,
      date: status === 'accepted' ? (r.accepted_at as string) : r.expires_at,
      delivery,
      // El motivo solo acompaña a un fallo: en los demas casos o no lo hay, o es un
      // detalle de un evento intermedio que no dice nada util a quien mira.
      delivery_detail: delivery === 'failed' ? r.delivery_detail : null,
    };
  });

  const ORDER: Record<DireccionInvitationStatus, number> = {
    pending: 0,
    expired: 1,
    accepted: 2,
  };
  rows.sort(
    (a, b) =>
      // A-3 — las que NO llegaron, arriba del todo. Es lo unico de esta pantalla sobre
      // lo que hay que hacer algo hoy: las demas solo hay que esperarlas.
      (a.delivery === 'failed' ? 0 : 1) - (b.delivery === 'failed' ? 0 : 1) ||
      ORDER[a.status] - ORDER[b.status] ||
      // Pendientes: la que caduca antes, primero. Caducadas/aceptadas: la más reciente primero.
      (a.status === 'pending' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date))
  );
  return rows;
}

/** Fila del progreso de informes de UN equipo en UNA campaña (informativa). */
export type DireccionTeamReportProgress = {
  teamId: string;
  team_name: string;
  category_name: string | null;
  period: string;
  done: number;
  total: number;
};

/**
 * Progreso de informes POR EQUIPO Y CAMPAÑA de la temporada activa (roster activo vs
 * informes completados). Desglosa por equipo lo que `countPendingReports` sumaba en un
 * solo número: una fila por (equipo × campaña lanzada) con informes pendientes
 * (`done < total`) — "a qué entrenador apretar". NO lista jugadores. Mismas tablas y
 * criterio (`reportStatus`) que el conteo del inicio; `development_reports_select` ya
 * da al director lectura club-wide (mig c1b). Sin acciones.
 */
export async function listTeamsReportProgressFromClient(
  supabase: DbClient,
  clubId: string
): Promise<DireccionTeamReportProgress[]> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return [];
  const seasonId = season.id as string;
  const seasonLabel = season.label as string;

  const { data: campaignRows } = await supabase
    .from('assessment_campaigns')
    .select('period, due_date, status')
    .eq('season_id', seasonId)
    .eq('status', 'launched');
  const periods = [
    ...new Set(
      ((campaignRows ?? []) as Array<{ period: string; due_date: string | null }>)
        .filter((c) => c.due_date)
        .map((c) => c.period)
    ),
  ];
  if (periods.length === 0) return [];

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, categories!inner(name, club_id)')
    .eq('season', seasonLabel)
    .eq('categories.club_id', clubId);
  const teams = ((teamRows ?? []) as unknown as Array<{
    id: string;
    name: string;
    categories: { name: string; club_id: string } | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.categories?.name ?? null,
  }));
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select('team_id, player_id')
    .in('team_id', teamIds)
    .is('left_at', null);
  const rosterByTeam = new Map<string, Set<string>>();
  for (const r of (rosterRows ?? []) as Array<{ team_id: string; player_id: string }>) {
    const set = rosterByTeam.get(r.team_id) ?? new Set<string>();
    set.add(r.player_id);
    rosterByTeam.set(r.team_id, set);
  }

  const { data: reportRows } = await supabase
    .from('development_reports')
    .select('team_id, player_id, period, scores')
    .eq('season_id', seasonId)
    .in('team_id', teamIds)
    .in('period', periods);
  const completedByTeamPeriod = new Map<string, Set<string>>();
  for (const r of (reportRows ?? []) as Array<{
    team_id: string;
    player_id: string;
    period: string;
    scores: Record<string, number>;
  }>) {
    const roster = rosterByTeam.get(r.team_id);
    if (
      roster?.has(r.player_id) &&
      reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed'
    ) {
      const key = `${r.team_id}:${r.period}`;
      const set = completedByTeamPeriod.get(key) ?? new Set<string>();
      set.add(r.player_id);
      completedByTeamPeriod.set(key, set);
    }
  }

  const rows: DireccionTeamReportProgress[] = [];
  for (const team of teams) {
    const total = rosterByTeam.get(team.id)?.size ?? 0;
    if (total === 0) continue;
    for (const period of periods) {
      const done = completedByTeamPeriod.get(`${team.id}:${period}`)?.size ?? 0;
      if (total - done > 0) {
        rows.push({
          teamId: team.id,
          team_name: team.name,
          category_name: team.category,
          period,
          done,
          total,
        });
      }
    }
  }
  // Más pendientes primero (a quién apretar antes); desempate por nombre de equipo.
  rows.sort(
    (a, b) => b.total - b.done - (a.total - a.done) || a.team_name.localeCompare(b.team_name)
  );
  return rows;
}
