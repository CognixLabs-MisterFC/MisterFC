import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { MANAGEABLE_MATCH_TYPES } from '../events/types';
import { getStaffTeamsFromClient } from '../team-view/queries';

type DbClient = SupabaseClient<Database>;

/** Fila del SELECTOR de partido (Alineación / Post-partido). */
export type StaffSeasonMatch = {
  eventId: string;
  startsAt: string;
  teamName: string;
  opponentName: string | null;
  categoryName: string;
};

/**
 * O2 QA (E6/E7) — Partidos de la TEMPORADA (pasados y futuros) de los equipos del
 * cuerpo técnico, para el SELECTOR de partido de Alineación y Post-partido: esas
 * pantallas, abiertas desde el menú SIN eventId, eran un callejón sin salida (no
 * tenían de dónde elegir). Reutiliza `getStaffTeamsFromClient` (equipos del staff, ya
 * acotados a la temporada activa) y lista sus eventos de tipo partido desde `fromIso`
 * (inicio de la temporada activa). RLS = gate; más recientes/futuros primero. El
 * `onError` deja ver en Sentry un fallo de RLS/Postgres (no se traga).
 */
export async function getStaffSeasonMatchesFromClient(
  supabase: DbClient,
  params: { clubId: string; membershipId: string; fromIso: string },
  onError?: (err: unknown) => void,
): Promise<StaffSeasonMatch[]> {
  const teams = await getStaffTeamsFromClient(
    supabase,
    { membershipId: params.membershipId, clubId: params.clubId },
    onError,
  );
  if (teams.length === 0) return [];
  const meta = new Map(teams.map((t) => [t.teamId, { name: t.name, category: t.categoryName }]));

  const { data, error } = await supabase
    .from('events')
    .select('id, team_id, opponent_name, starts_at, type')
    .eq('club_id', params.clubId)
    .in('team_id', [...meta.keys()])
    .in('type', MANAGEABLE_MATCH_TYPES)
    .gte('starts_at', params.fromIso)
    .order('starts_at', { ascending: false })
    .limit(200);
  if (error) onError?.(error);

  return (data ?? [])
    .filter((e) => e.starts_at != null && e.team_id != null)
    .map((e) => {
      const m = meta.get(e.team_id as string);
      return {
        eventId: e.id as string,
        startsAt: e.starts_at as string,
        teamName: m?.name ?? '',
        categoryName: m?.category ?? '',
        opponentName: (e.opponent_name as string | null) ?? null,
      };
    });
}
