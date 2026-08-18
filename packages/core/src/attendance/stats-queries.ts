/**
 * O2-5 E1 — Estadísticas de asistencia (histórico), framework-agnósticas.
 *
 * Extraído del cómputo de `apps/web/.../asistencia/queries.ts::loadAsistenciaStats`
 * (F4.8). Toda la agregación (buckets por código y por jugador, %) era JS inline
 * en la web; aquí queda como fetch+cálculo reutilizable. La web pasa a delegar
 * (resuelve scope + ventana y llama aquí). La app nativa de FAMILIA lo consume con
 * un scope de un solo jugador (el HIJO ACTIVO). La RLS acota lo visible.
 *
 * SOLO LECTURA. La familia no pasa lista (eso es staff, vive en la web).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { AttendanceCode } from '../schemas/attendance';

type Sb = SupabaseClient<Database>;

export type AttendanceStatsScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: readonly string[] }
  | { kind: 'player'; playerIds: readonly string[] };

export type AttendancePlayerStat = {
  player_id: string;
  first_name: string;
  last_name: string;
  team_id: string;
  team_name: string;
  total: number;
  present: number;
  justified: number;
  unjustified: number;
  partial: number;
  pct_present: number;
};

export type AttendanceCodeBucket = {
  code: AttendanceCode;
  count: number;
  pct: number;
};

export type AttendanceStatsResult = {
  byPlayer: AttendancePlayerStat[];
  byCode: AttendanceCodeBucket[];
  totalRecorded: number;
};

export type AttendanceStatsRange = '7d' | '30d' | 'season' | 'custom';

/**
 * Ventana temporal del rango. Igual que la `rangeToWindow` de la web pero con
 * `now` explícito (determinista/testeable). `season` = 1 de agosto del curso.
 */
export function attendanceStatsWindow(
  range: AttendanceStatsRange,
  now: Date,
  custom?: { start?: string; end?: string },
): { startIso: string; endIso: string } {
  if (range === 'custom' && custom?.start && custom?.end) {
    return {
      startIso: new Date(`${custom.start}T00:00:00Z`).toISOString(),
      endIso: new Date(`${custom.end}T23:59:59Z`).toISOString(),
    };
  }
  if (range === '7d') {
    return {
      startIso: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  if (range === '30d') {
    return {
      startIso: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      endIso: now.toISOString(),
    };
  }
  const year =
    now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    startIso: new Date(Date.UTC(year, 7, 1)).toISOString(),
    endIso: now.toISOString(),
  };
}

/**
 * Agrega asistencia a entrenos por jugador y por código en la ventana dada,
 * acotada por `scope`. Réplica del cómputo de `loadAsistenciaStats` (mismas
 * queries, mismo mapeo de códigos y ordenación por apellido).
 */
export async function getAttendanceStatsFromClient(
  supabase: Sb,
  params: {
    clubId: string;
    scope: AttendanceStatsScope;
    startIso: string;
    endIso: string;
    teamId?: string;
  },
): Promise<AttendanceStatsResult> {
  const { clubId, scope, startIso, endIso, teamId } = params;

  let q = supabase
    .from('training_attendance')
    .select(
      `id, event_id, player_id, code,
       events!inner(id, club_id, team_id, starts_at,
                    teams!inner(id, name)),
       players!inner(id, first_name, last_name)`,
    )
    .gte('events.starts_at', startIso)
    .lte('events.starts_at', endIso)
    // F14F-1b — las estadísticas de asistencia excluyen entrenos cancelados.
    .is('events.cancelled_at', null);

  if (teamId) q = q.eq('events.team_id', teamId);

  const { data: rawRows } = await q;

  type StatRow = {
    code: AttendanceCode;
    player_id: string;
    events: {
      club_id: string;
      team_id: string;
      teams: { id: string; name: string };
    };
    players: { id: string; first_name: string; last_name: string };
  };
  const rows = (rawRows ?? [])
    .map((r) => r as unknown as StatRow)
    .filter((r) => r.events.club_id === clubId);

  const filteredRows = rows.filter((r) => {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'restricted')
      return scope.teamIds.includes(r.events.team_id);
    if (scope.kind === 'player') return scope.playerIds.includes(r.player_id);
    return false;
  });

  const totalRecorded = filteredRows.length;

  const codeCounts = new Map<AttendanceCode, number>();
  for (const r of filteredRows) {
    codeCounts.set(r.code, (codeCounts.get(r.code) ?? 0) + 1);
  }
  const byCode: AttendanceCodeBucket[] = Array.from(codeCounts.entries())
    .map(([code, count]) => ({
      code,
      count,
      pct: totalRecorded > 0 ? (count / totalRecorded) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const playerAgg = new Map<
    string,
    {
      player_id: string;
      first_name: string;
      last_name: string;
      team_id: string;
      team_name: string;
      total: number;
      present: number;
      justified: number;
      unjustified: number;
      partial: number;
    }
  >();

  for (const r of filteredRows) {
    let p = playerAgg.get(r.player_id);
    if (!p) {
      p = {
        player_id: r.player_id,
        first_name: r.players.first_name,
        last_name: r.players.last_name,
        team_id: r.events.teams.id,
        team_name: r.events.teams.name,
        total: 0,
        present: 0,
        justified: 0,
        unjustified: 0,
        partial: 0,
      };
      playerAgg.set(r.player_id, p);
    }
    p.total++;
    switch (r.code) {
      case 'presente':
        p.present++;
        break;
      case 'ausente':
        p.unjustified++;
        break;
      case 'entreno_diferenciado':
        p.partial++;
        break;
      default:
        p.justified++;
        break;
    }
  }

  const byPlayer: AttendancePlayerStat[] = Array.from(playerAgg.values())
    .map((p) => ({
      ...p,
      pct_present: p.total > 0 ? (p.present / p.total) * 100 : 0,
    }))
    .sort((a, b) =>
      (a.last_name ?? '').localeCompare(b.last_name ?? '', 'es', {
        sensitivity: 'base',
      }),
    );

  return { byPlayer, byCode, totalRecorded };
}

/**
 * O2 — Código de asistencia de UN jugador para un conjunto de entrenamientos ya
 * celebrados (histórico de Entrenamientos, área familia). Devuelve `event_id →
 * code` solo para los eventos con registro; los que el entrenador aún no marcó no
 * aparecen en el mapa. SOLO LECTURA; la RLS de `training_attendance` acota lo
 * visible (el tutor ve las filas de su hijo, igual que en `getAttendanceStats`).
 */
export async function getPlayerTrainingAttendanceForEventsFromClient(
  supabase: Sb,
  playerId: string,
  eventIds: readonly string[],
): Promise<Map<string, AttendanceCode>> {
  const out = new Map<string, AttendanceCode>();
  if (eventIds.length === 0) return out;

  const { data } = await supabase
    .from('training_attendance')
    .select('event_id, code')
    .eq('player_id', playerId)
    .in('event_id', eventIds as string[]);

  for (const r of data ?? []) {
    const ev = r.event_id as string | null;
    if (ev) out.set(ev, r.code as AttendanceCode);
  }
  return out;
}
