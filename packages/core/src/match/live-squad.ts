import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { deriveExpelledPlayers } from './event';
import { DEFAULT_REGIME, type SubstitutionRegime } from './regime';
import { deriveSquad, type FieldSlot, type Squad, type Sub } from './squad';

/**
 * LO QUE HACE FALTA LEER para saber quién está en el campo AHORA, y la derivación
 * que lo convierte en el once vivo.
 *
 * El motor (`deriveSquad`) es puro y lleva desde F7.5 las reglas que importan: el
 * que entra ocupa el hueco del que sale, un expulsado o un ausente no está en el
 * campo, y quien ya salió solo reentra si el RÉGIMEN de su categoría lo permite.
 * Lo que no existía era la forma de alimentarlo fuera de la web: la carga vivía
 * dentro de `apps/web/.../directo/actions.ts`, privada, así que la app no podía
 * usarla aunque quisiera.
 *
 * Y no querer usarla costaba esto: la entrada rápida del móvil ofrecía como
 * «quién sale» a los TITULARES de la alineación oficial y como «quién entra» a
 * todo el resto de la convocatoria. Después del primer cambio, el que acababa de
 * salir seguía ofreciéndose para salir, el que acababa de entrar no se podía
 * sacar, y la reentrada no la miraba nadie. Un cambio apuntado sobre el jugador
 * equivocado no se queda en el acta: `playing-time` reparte los minutos POR esos
 * eventos, y esos minutos acaban en la ficha del crío.
 *
 * Por eso esto baja a core entero —lectura y derivación— y lo usan las dos.
 */
type DbClient = SupabaseClient<Database>;

/**
 * Lo PERSISTIDO que necesita `deriveSquad`, antes de derivar. Se devuelve en
 * crudo, y no el `Squad` ya hecho, porque la app tiene una pieza más que añadir:
 * las sustituciones que todavía están en su cola offline. Si esto devolviera el
 * resultado, esas quedarían fuera y el entrenador vería las listas viejas hasta
 * que la fila subiera al servidor — justo en la pantalla donde acaba de tocar.
 */
export type LiveSquadInputs = {
  /** Huecos del campo: las posiciones de campo de la alineación oficial. */
  slots: FieldSlot[];
  /** Suplentes de la alineación oficial. */
  bench: string[];
  /** Sustituciones persistidas, en orden cronológico. */
  subs: Sub[];
  /** Expulsados (1 roja o 2 amarillas), derivado de las tarjetas. */
  expelled: string[];
  /** Ausentes del partido (`match_absences`). */
  absent: string[];
  /** Régimen de cambios de (categoría, división): tope y reentrada. */
  regime: SubstitutionRegime;
};

/**
 * F7.6c — régimen de cambios del equipo del partido, resuelto desde
 * (`categories.kind`, `teams.division`) contra `substitution_regimes`.
 *
 * Sin fila —categoría sin divisiones cargadas, o división nula— devuelve el
 * DEFAULT, que es el RESTRICTIVO (7 cambios, sin reentrada): un hueco en los datos
 * de referencia no puede regalar cambios ilimitados en silencio.
 */
export async function getSubstitutionRegimeFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<SubstitutionRegime> {
  const { data } = await supabase
    .from('events')
    .select('teams!inner(division, categories!inner(kind))')
    .eq('id', eventId)
    .maybeSingle();
  type Shape = { teams: { division: string | null; categories: { kind: string | null } } } | null;
  const team = (data as unknown as Shape)?.teams;
  const kind = team?.categories?.kind ?? null;
  const division = team?.division ?? null;
  if (!kind || !division) return DEFAULT_REGIME;

  const { data: row } = await supabase
    .from('substitution_regimes')
    .select('regime_type, max_subs, allow_reentry')
    .eq('category_kind', kind)
    .eq('division', division)
    .maybeSingle();
  if (!row) return DEFAULT_REGIME;
  return {
    type: row.regime_type as SubstitutionRegime['type'],
    maxSubs: (row.max_subs as number | null) ?? null,
    allowReentry: row.allow_reentry as boolean,
  };
}

/**
 * Las cuatro lecturas del once vivo: alineación oficial (huecos + banquillo),
 * eventos propios (cambios y tarjetas), ausencias y régimen.
 *
 * Sin alineación oficial no hay huecos, y entonces `deriveSquad` devuelve un once
 * vacío. Es lo correcto y no un fallo: un partido sin alineación no tiene a nadie
 * en el campo, y la pantalla ya lo dice por su cuenta.
 */
export async function getLiveSquadInputsFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<LiveSquadInputs> {
  const { data: official } = await supabase
    .from('lineups')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();

  const slots: FieldSlot[] = [];
  const bench: string[] = [];
  if (official?.id) {
    const { data: positions } = await supabase
      .from('lineup_positions')
      .select('player_id, position_code, x_pct, y_pct, location')
      .eq('lineup_id', official.id as string);
    for (const p of positions ?? []) {
      if (p.location === 'field') {
        slots.push({
          playerId: p.player_id as string,
          positionCode: (p.position_code as string | null) ?? null,
          xPct: p.x_pct == null ? null : Number(p.x_pct),
          yPct: p.y_pct == null ? null : Number(p.y_pct),
        });
      } else if (p.location === 'bench') {
        bench.push(p.player_id as string);
      }
    }
  }

  // Los cambios van en ORDEN: `deriveSquad` encadena ocupantes por hueco, así que
  // dos cambios sobre el mismo hueco leídos al revés dejan dentro al que salió.
  const { data: ownEvents } = await supabase
    .from('match_events')
    .select('type, player_id, related_player_id, clock_seconds')
    .eq('event_id', eventId)
    .eq('side', 'own')
    .order('clock_seconds', { ascending: true });

  const subs: Sub[] = [];
  const tarjetas: { type: string; playerId: string | null }[] = [];
  for (const e of ownEvents ?? []) {
    if (e.type === 'substitution' && e.player_id && e.related_player_id) {
      subs.push({ out: e.player_id as string, in: e.related_player_id as string });
    } else if (e.type === 'yellow_card' || e.type === 'red_card') {
      tarjetas.push({ type: e.type as string, playerId: e.player_id as string | null });
    }
  }

  const { data: absRows } = await supabase
    .from('match_absences')
    .select('player_id')
    .eq('event_id', eventId);

  const regime = await getSubstitutionRegimeFromClient(supabase, eventId);

  return {
    slots,
    bench,
    subs,
    expelled: [...deriveExpelledPlayers(tarjetas)],
    absent: (absRows ?? []).map((r) => r.player_id as string),
    regime,
  };
}

/**
 * El once vivo a partir de lo leído, más las sustituciones que el llamador tenga
 * PENDIENTES de subir (la cola offline de la app; la web pasa ninguna).
 *
 * Van al final y en orden: una sustitución recién tocada es, por definición, la
 * más reciente, y `deriveSquad` encadena por hueco en el orden que recibe.
 */
export function deriveLiveSquad(
  inputs: LiveSquadInputs,
  pendientes: readonly Sub[] = [],
): Squad {
  return deriveSquad({
    slots: inputs.slots,
    bench: inputs.bench,
    subs: [...inputs.subs, ...pendientes],
    expelled: inputs.expelled,
    absent: inputs.absent,
    allowReentry: inputs.regime.allowReentry,
  });
}

/** Cuántas sustituciones se han hecho ya (persistidas + pendientes): el tope del régimen. */
export function countSubs(inputs: LiveSquadInputs, pendientes: readonly Sub[] = []): number {
  return inputs.subs.length + pendientes.length;
}
