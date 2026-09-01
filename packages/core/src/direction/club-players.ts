/**
 * O2-11a-2 — Lectura CLUB-WIDE de jugadores para la banda de DIRECCIÓN (nativa).
 *
 * La web resuelve el listado en `jugadores/queries.ts` (`loadGlobalPlayers`), un
 * motor de scope+filtros+paginación con la lógica de visibilidad por rol (admin/
 * coord/principal/ayudante) que la app de dirección NO necesita: dirección es
 * SIEMPRE club-wide (admin_club·director; el gate real es `AreaGuard('direction')`)
 * y SOLO LECTURA (sin crear/editar — eso se queda en web). Por eso esto es una
 * lectura NUEVA y fina, no un wrapper de aquel motor (envolverlo cambiaría el
 * comportamiento filtrado/paginado de la web).
 *
 * Devuelve los jugadores CLUB-ACTIVOS del club (left_club_at IS NULL) que NO están
 * suprimidos (erased_at IS NULL — derecho al olvido), con su equipo activo (la
 * pertenencia `team_members` abierta), ordenados por apellido/nombre. La RLS
 * `players_select_member` (cualquier miembro del club) deja leerlos; el candado de
 * la banda es el AreaGuard, no esta lectura.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { hasLinkedFamily } from '../players/family-link';

type DbClient = SupabaseClient<Database>;

export type ClubPlayerRow = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  dorsal: number | null;
  positionMain: string | null;
  currentTeamId: string | null;
  currentTeamName: string | null;
  currentTeamColor: string | null;
  /**
   * `true` = la familia NO ha entrado en la app, así que NO recibe convocatorias ni
   * avisos (marcador "Sin app"). Solo presentación — no gatea convocatoria/
   * asistencia/estadísticas.
   */
  noApp: boolean;
};

export async function getClubPlayersFromClient(
  supabase: DbClient,
  clubId: string
): Promise<ClubPlayerRow[]> {
  const { data } = await supabase
    .from('players')
    .select(
      `id, first_name, last_name, date_of_birth, dorsal, position_main,
       team_members!left(team_id, left_at, teams(id, name, color)),
       player_accounts(profile_id)`
    )
    .eq('club_id', clubId)
    // Suprimidos (derecho al olvido) y bajas del club fuera del directorio.
    .is('erased_at', null)
    .is('left_club_at', null)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  type TMRow = {
    team_id: string;
    left_at: string | null;
    teams: { id: string; name: string; color: string } | null;
  };

  return (data ?? []).map((p) => {
    const tms = (p.team_members as unknown as TMRow[] | null) ?? [];
    const active = tms.find((tm) => tm.left_at == null && tm.teams);
    const accounts =
      (p.player_accounts as unknown as Array<{ profile_id: string }> | null) ?? [];
    return {
      id: p.id as string,
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
      dateOfBirth: (p.date_of_birth as string | null) ?? null,
      dorsal: (p.dorsal as number | null) ?? null,
      positionMain: (p.position_main as string | null) ?? null,
      currentTeamId: active?.teams?.id ?? null,
      currentTeamName: active?.teams?.name ?? null,
      currentTeamColor: active?.teams?.color ?? null,
      noApp: !hasLinkedFamily(accounts),
    };
  });
}
