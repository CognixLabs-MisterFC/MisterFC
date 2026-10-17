/**
 * CORREGIR un evento del directo: borrar, cambiar el minuto, cambiar el actor.
 *
 * Extraído de `apps/web/.../convocatorias/[eventId]/directo/actions.ts` (F7.9), que
 * pasa a DELEGAR aquí, igual que hizo `state-writes` con el reloj. La app nativa lo
 * llama directamente detrás del write-guard.
 *
 * SOLO CON RED, y no es una limitación perezosa: estas tres operaciones LEEN la fila
 * en el servidor antes de escribir (el actor necesita el `side`/`type` para no violar
 * los CHECK), y la cola offline del directo está diseñada para ALTAS idempotentes por
 * id, no para ediciones ordenadas — dos ediciones del mismo evento aplicadas en orden
 * distinto dan resultados distintos. Corregir un error no se hace en mitad del campo
 * sin cobertura; se hace después. Decisión de Jose, 2026-10-16.
 *
 * EL GATE autoritativo sigue siendo la RLS (`user_can_record_match`, que cubre update
 * y delete de `match_events`) más el trigger `match_events_validate`. Aquí NO se
 * reimplementa: un rechazo llega como 42501 → `forbidden`.
 *
 * LA VENTANA DE EDICIÓN es `live` o `closed`. `not_started` no se edita porque no hay
 * nada que corregir, y además no hay reloj del que derivar un minuto.
 *
 * RE-CONSOLIDACIÓN. Si el partido ya está `closed`, las stats y el marcador están
 * materializados (`consolidateAndPersist` ← `finishMatch`), así que cualquier edición
 * tiene que RE-materializarlos o el acta deja de cuadrar. Esto vivía solo en la web;
 * ahora está aquí, que es lo que hace que la corrección desde la app no deje el acta
 * a medias. En `live` no toca nada: las stats aún no existen.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import {
  addTimelineEventSchema,
  deleteMatchEventSchema,
  updateEventActorSchema,
  updateEventMinuteSchema,
} from '../schemas/match-event';
import { clockFieldsForMinute } from './timeline';
import type { ClockPeriod, PeriodKind } from './clock';
import { consolidateMatchAndPersistFromClient } from './state-writes';

type DbClient = SupabaseClient<Database>;

export type EventEditError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'not_editable'
  | 'no_period'
  | 'player_not_in_team'
  | 'generic';

export type EventEditOutcome = { ok: true } | { ok: false; error: EventEditError };

/** Réplica de `mapEventErr` de la web (42501 → forbidden). */
function mapEditPgErr(message: string | undefined, code: string | undefined): EventEditError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('player_not_in_team_at_event')) return 'player_not_in_team';
  if (message.includes('event_not_match')) return 'invalid';
  if (message.includes('event_without_team')) return 'invalid';
  // Las dos columnas que el trigger de validación declara inmutables. Llegar aquí
  // significa que alguien intentó mover un evento de partido o cambiar su autor:
  // no es un fallo transitorio, es una petición que no se debe hacer.
  if (message.includes('event_id_immutable')) return 'invalid';
  if (message.includes('created_by_immutable')) return 'invalid';
  return 'generic';
}

/** Estado del partido, o null si no hay fila (partido sin directo abierto). */
async function loadStatus(
  supabase: DbClient,
  eventId: string,
): Promise<'not_started' | 'live' | 'closed' | null> {
  const { data } = await supabase
    .from('match_state')
    .select('status')
    .eq('event_id', eventId)
    .maybeSingle();
  return (data?.status as 'not_started' | 'live' | 'closed' | undefined) ?? null;
}

/** La ventana de edición: `live` o `closed`. Cualquier otra cosa → no editable. */
async function loadEditableStatus(
  supabase: DbClient,
  eventId: string,
): Promise<'live' | 'closed' | null> {
  const status = await loadStatus(supabase, eventId);
  return status === 'live' || status === 'closed' ? status : null;
}

async function loadPeriods(supabase: DbClient, eventId: string): Promise<ClockPeriod[]> {
  const { data } = await supabase
    .from('match_periods')
    .select(
      'period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended',
    )
    .eq('event_id', eventId)
    .order('ordinal', { ascending: true });
  return (data ?? []).map((r) => ({
    period: r.period as PeriodKind,
    ordinal: r.ordinal as number,
    baseOffsetSeconds: r.base_offset_seconds as number,
    accumulatedSeconds: r.accumulated_seconds as number,
    running: r.running as boolean,
    lastStartedAt: r.last_started_at as string | null,
    ended: r.ended as boolean,
  }));
}

/**
 * Si el partido está CERRADO, re-materializa stats y marcador. Devuelve el error de
 * dominio si la consolidación falla, o null si no había nada que hacer.
 *
 * Reusa `consolidateMatchAndPersistFromClient` (delete+reinsert idempotente), que NO
 * cambia `match_state.status`: el partido SIGUE cerrado y no se dispara ni un
 * reopen→finish ni una notificación.
 */
async function reconsolidateIfClosed(
  supabase: DbClient,
  eventId: string,
): Promise<EventEditError | null> {
  const status = await loadStatus(supabase, eventId);
  if (status !== 'closed') return null;
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return 'forbidden';
  const err = await consolidateMatchAndPersistFromClient(supabase, eventId, user.id);
  if (!err) return null;
  return err === 'invalid' || err === 'forbidden' ? err : 'generic';
}

// ─────────────────────────────────────────────────────────────────────────────
// Qué puede hacer la pantalla, puro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que la pantalla puede ofrecer sobre un evento ya subido.
 *
 * Vive aquí y no en el componente por el motivo de siempre en esta app: nativa no
 * tiene tests de componentes, así que una decisión dentro del render no se puede
 * poner roja. Hermana de `lineupEmptyAction`.
 *
 * EL ORDEN DE PRECEDENCIA ES LA REGLA, no un detalle:
 *  1. `no_permission` — sin el gate no hay nada que ofrecer, y la pantalla lo DICE
 *     en vez de dejar la misma frase que a quien sí puede.
 *  2. `not_editable` — un partido sin empezar no tiene nada que corregir, y encima no
 *     hay reloj del que derivar un minuto. Va ANTES que la red: con o sin cobertura,
 *     la respuesta es la misma, y decir «sin conexión» ahí mandaría al entrenador a
 *     buscar cobertura para algo que tampoco podría hacer con ella.
 *  3. `offline` — puede y el partido lo admite, pero una corrección no se encola.
 *  4. `edit`.
 */
export type EventEditAvailability = 'edit' | 'offline' | 'no_permission' | 'not_editable';

export function eventEditAvailability(state: {
  canRecord: boolean;
  online: boolean;
  status: 'not_started' | 'live' | 'closed' | null;
}): EventEditAvailability {
  if (!state.canRecord) return 'no_permission';
  if (state.status !== 'live' && state.status !== 'closed') return 'not_editable';
  return state.online ? 'edit' : 'offline';
}

// ─────────────────────────────────────────────────────────────────────────────
// La regla del ACTOR, pura
// ─────────────────────────────────────────────────────────────────────────────

export type ActorPatch = {
  player_id?: string;
  related_player_id?: string;
  rival_dorsal?: number;
};

/**
 * Qué campos se pueden cambiar en ESTA fila, según su `side` y su `type`. Es pura
 * para poder ponerse roja: es la regla que evita violar los CHECK de la tabla, y un
 * CHECK violado llega a la pantalla como un «error genérico» que no explica nada.
 *
 *  · side='own'  → `player_id`. Y `related_player_id` SOLO en sustituciones, porque
 *    el CHECK `related_only_sub` lo prohíbe en cualquier otro tipo.
 *  · side='rival' → `rival_dorsal`. Un evento del rival no tiene jugador nuestro:
 *    el CHECK `actor_by_side` lo impide.
 *
 * Devuelve un parche VACÍO cuando nada de lo pedido encaja con la fila, y el llamante
 * lo traduce a `invalid`. Lo que NO hace es colar el campo equivocado y dejar que la
 * base lo rechace: el mensaje que vería el entrenador no diría nada.
 */
export function actorPatchFor(
  row: { side: 'own' | 'rival'; type: string },
  input: { player_id?: string; related_player_id?: string; rival_dorsal?: number },
): ActorPatch {
  const patch: ActorPatch = {};
  if (row.side === 'own') {
    if (input.player_id) patch.player_id = input.player_id;
    if (row.type === 'substitution' && input.related_player_id) {
      patch.related_player_id = input.related_player_id;
    }
  } else if (input.rival_dorsal != null) {
    patch.rival_dorsal = input.rival_dorsal;
  }
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Las tres escrituras
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BORRAR un evento. El `event_id` va en el filtro además del `id` a propósito: es la
 * misma pareja que usa la web, y deja el borrado acotado al partido que se está
 * editando aunque llegara un id de otro.
 *
 * Los avisos de push pendientes de ese gol los retira el trigger
 * `trg_unnotify_deleted_goal` (mig 20261127000000), no este código: la RLS de
 * `notifications` no tiene política de DELETE, así que el cliente no podría.
 */
export async function deleteMatchEventFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<EventEditOutcome> {
  const parsed = deleteMatchEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, id } = parsed.data;

  if ((await loadEditableStatus(supabase, event_id)) == null) {
    return { ok: false, error: 'not_editable' };
  }

  const { error } = await supabase
    .from('match_events')
    .delete()
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { ok: false, error: mapEditPgErr(error.message, error.code) };

  const rc = await reconsolidateIfClosed(supabase, event_id);
  if (rc) return { ok: false, error: rc };
  return { ok: true };
}

/**
 * CAMBIAR EL MINUTO. El minuto que elige el entrenador es `display_minute`; de ahí se
 * derivan `clock_seconds` y `period` con el motor del reloj (`clockFieldsForMinute`,
 * el inverso de `displayMinute`). No se escribe el minuto a pelo: el orden del
 * timeline y el acta se derivan de `clock_seconds`, así que un minuto sin su reloj
 * dejaría el evento en el sitio equivocado.
 */
export async function updateMatchEventMinuteFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<EventEditOutcome> {
  const parsed = updateEventMinuteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, id, display_minute } = parsed.data;

  if ((await loadEditableStatus(supabase, event_id)) == null) {
    return { ok: false, error: 'not_editable' };
  }

  const periods = await loadPeriods(supabase, event_id);
  if (periods.length === 0) return { ok: false, error: 'no_period' };

  const { clockSeconds, period, displayMinute } = clockFieldsForMinute(periods, display_minute);

  const { error } = await supabase
    .from('match_events')
    .update({
      clock_seconds: clockSeconds,
      period,
      display_minute: displayMinute,
    })
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { ok: false, error: mapEditPgErr(error.message, error.code) };

  const rc = await reconsolidateIfClosed(supabase, event_id);
  if (rc) return { ok: false, error: rc };
  return { ok: true };
}

/**
 * CAMBIAR EL ACTOR. Lee la fila primero para saber qué campos son coherentes con su
 * `side`/`type` (ver `actorPatchFor`).
 *
 * La ausencia llega como `null` de `maybeSingle`, no como error, y es `not_found`: con
 * la RLS delante también significa «existe y no es de un partido que puedas grabar»,
 * y las dos cosas se le cuentan igual al entrenador — no hay nada que pueda hacer con
 * la diferencia.
 */
export async function updateMatchEventActorFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<EventEditOutcome> {
  const parsed = updateEventActorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, id, player_id, related_player_id, rival_dorsal } = parsed.data;

  if ((await loadEditableStatus(supabase, event_id)) == null) {
    return { ok: false, error: 'not_editable' };
  }

  const { data: row } = await supabase
    .from('match_events')
    .select('side, type')
    .eq('event_id', event_id)
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };

  const patch = actorPatchFor(
    { side: row.side as 'own' | 'rival', type: row.type as string },
    { player_id, related_player_id, rival_dorsal },
  );
  if (Object.keys(patch).length === 0) return { ok: false, error: 'invalid' };

  const { error } = await supabase
    .from('match_events')
    .update(patch)
    .eq('event_id', event_id)
    .eq('id', id);
  if (error) return { ok: false, error: mapEditPgErr(error.message, error.code) };

  const rc = await reconsolidateIfClosed(supabase, event_id);
  if (rc) return { ok: false, error: rc };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// AÑADIR un evento que se olvidó
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La fila de `match_events` de un alta MANUAL, construida a partir de lo que el
 * entrenador elige y del reloj del partido. Pura: dados el mismo input y los mismos
 * periodos, la misma fila.
 *
 * Vivía dentro de `addMatchEvent` (apps/web), que no tiene suite. Y es justo donde se
 * decide si la fila viola un CHECK de la tabla, que es un rechazo que llega a la
 * pantalla como «error genérico» y no explica nada. Las tres reglas que aplica:
 *
 *  · FALTA y CÓRNER son SIEMPRE nuestras. Se registran desde nuestro panel (§7.4b);
 *    un `side: 'rival'` que llegue se corrige aquí en vez de dejar que lo rechace la
 *    base. El esquema (`addTimelineEventSchema`) también lo exige, así que esto es el
 *    cinturón de los dos.
 *  · FUERA DE JUEGO, TIRO y CÓRNER propios van por UBICACIÓN, sin jugador. El resto de
 *    los tipos propios llevan jugador.
 *  · Las COORDENADAS solo en falta, fuera de juego y tiro — el CHECK
 *    `coords_field_only` incluye el córner, pero el córner no se marca en el campo,
 *    así que aquí no viajan.
 *
 * Y el `metadata` se monta por tipo: `outcome` solo en penalti, `foul_kind` solo en
 * falta, `corner_side` solo en córner, y la `note` solo en eventos del rival (es
 * donde se apunta a quién se le vio hacer qué, sin ficha de jugador).
 */
export type TimelineEventRow = {
  id: string;
  event_id: string;
  club_id: string;
  created_by: string;
  side: 'own' | 'rival';
  type: string;
  player_id: string | null;
  related_player_id: string | null;
  rival_dorsal: number | null;
  x_pct: number | null;
  y_pct: number | null;
  period: PeriodKind;
  clock_seconds: number;
  display_minute: number;
  metadata: Record<string, string>;
};

export function buildTimelineEventRow(
  input: {
    id: string;
    event_id: string;
    side: 'own' | 'rival';
    type: string;
    display_minute: number;
    player_id?: string;
    related_player_id?: string;
    rival_dorsal?: number;
    outcome?: string;
    foul_kind?: string;
    corner_side?: string;
    x_pct?: number;
    y_pct?: number;
    note?: string;
  },
  ctx: { clubId: string; createdBy: string; periods: readonly ClockPeriod[] },
): TimelineEventRow {
  const { clockSeconds, period, displayMinute } = clockFieldsForMinute(
    ctx.periods,
    input.display_minute,
  );

  const side: 'own' | 'rival' =
    input.type === 'foul' || input.type === 'corner' ? 'own' : input.side;

  const porUbicacion = input.type === 'offside' || input.type === 'shot' || input.type === 'corner';
  const conCoordenadas = input.type === 'foul' || input.type === 'offside' || input.type === 'shot';

  const metadata: Record<string, string> = {};
  if (input.type === 'penalty' && input.outcome) metadata.outcome = input.outcome;
  if (input.type === 'foul' && input.foul_kind) metadata.foul_kind = input.foul_kind;
  if (input.type === 'corner' && input.corner_side) {
    metadata.corner_side = input.corner_side;
  }
  const nota = input.note?.trim();
  if (side === 'rival' && nota) metadata.note = nota;

  return {
    id: input.id,
    event_id: input.event_id,
    club_id: ctx.clubId,
    created_by: ctx.createdBy,
    side,
    type: input.type,
    player_id: side === 'own' && !porUbicacion ? (input.player_id ?? null) : null,
    related_player_id: input.type === 'substitution' ? (input.related_player_id ?? null) : null,
    rival_dorsal: side === 'rival' ? (input.rival_dorsal ?? null) : null,
    x_pct: conCoordenadas && input.x_pct !== undefined ? input.x_pct : null,
    y_pct: conCoordenadas && input.y_pct !== undefined ? input.y_pct : null,
    period,
    clock_seconds: clockSeconds,
    display_minute: displayMinute,
    metadata,
  };
}

/**
 * ALTA de un evento olvidado, en el minuto que diga el entrenador.
 *
 * `upsert` con `ignoreDuplicates` por el id de cliente: subir dos veces el mismo id no
 * duplica. Es la misma idempotencia que la cola del directo, y la que permite que la
 * carga en cadena reintente sin miedo.
 *
 * `reconsolidate: false` existe para la carga EN CADENA: re-materializar stats y
 * marcador en cada alta son N pasadas completas (releer todo y delete+reinsert) para
 * cargar un partido de veinticinco eventos. En cadena se pasa `false` y se consolida
 * UNA vez al final; para un alta suelta, el valor por defecto hace lo correcto.
 */
export async function addMatchEventFromClient(
  supabase: DbClient,
  input: unknown,
  opts: { reconsolidate?: boolean } = {},
): Promise<EventEditOutcome> {
  const parsed = addTimelineEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const datos = parsed.data;

  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { ok: false, error: 'forbidden' };

  const { data: ev } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', datos.event_id)
    .maybeSingle();
  if (!ev) return { ok: false, error: 'not_found' };

  if ((await loadEditableStatus(supabase, datos.event_id)) == null) {
    return { ok: false, error: 'not_editable' };
  }

  const periods = await loadPeriods(supabase, datos.event_id);
  if (periods.length === 0) return { ok: false, error: 'no_period' };

  const row = buildTimelineEventRow(datos, {
    clubId: ev.club_id as string,
    createdBy: user.id,
    periods,
  });

  const { error } = await supabase
    .from('match_events')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { ok: false, error: mapEditPgErr(error.message, error.code) };

  if (opts.reconsolidate === false) return { ok: true };
  const rc = await reconsolidateIfClosed(supabase, datos.event_id);
  if (rc) return { ok: false, error: rc };
  return { ok: true };
}

/**
 * La re-consolidación a mano, para cuando se han metido varios eventos con
 * `reconsolidate: false`. Es el cierre de la carga en cadena: una sola pasada.
 *
 * Devuelve `ok` también cuando el partido está en vivo y no hay nada que
 * materializar: no es un fallo, es que las stats todavía no existen.
 */
export async function reconsolidateMatchFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<EventEditOutcome> {
  const rc = await reconsolidateIfClosed(supabase, eventId);
  return rc ? { ok: false, error: rc } : { ok: true };
}
