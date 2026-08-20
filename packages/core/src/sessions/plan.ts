import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import { buildDefaultSkeleton, sessionDateFromEventStart } from './sessions';
import {
  updateSessionHeaderMobileSchema,
  toSessionHeaderMobileColumns,
} from './session-form';

/**
 * G1 — Orquestación de ESCRITURA del planificador de sesiones para el cliente
 * (nativo). Extrae la lógica que en la web vivía en las server actions
 * (`createSession`/`planSessionForEvent`) para que la app la ejecute directamente
 * contra Supabase con RLS como gate (sin service-role). Desde #477 todo el cuerpo
 * técnico puede crear sesiones (sin capability); el gate real es la RLS de INSERT.
 */
type DbClient = SupabaseClient<Database>;

export type SessionWriteError =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'generic';

function mapErr(code: string | undefined): SessionWriteError {
  if (code === '42501') return 'forbidden'; // RLS
  if (code === 'P0002') return 'not_found'; // no_data_found (RAISE del RPC)
  return 'generic';
}

export type PlanSessionResult = { id: string | null; error?: SessionWriteError };

/**
 * Planificar la sesión de un ENTRENAMIENTO (link-or-create). Siempre ASIGNADA
 * (#484): la sesión nace con `event_id`. Tres caminos:
 *  1. el evento YA tiene sesión → se devuelve su id (idempotente, 1:1);
 *  2. `templateId` → se CLONA la plantilla y se VINCULA al evento;
 *  3. sin plantilla → se crea EN BLANCO y se siembra el esqueleto estándar.
 *
 * Qué hereda cada cosa:
 *  · del EVENTO: equipo (`team_id`), fecha (`session_date`, en la zona del club) y el
 *    vínculo `event_id`.
 *  · de la PLANTILLA (solo camino 2): nombre, objetivos (físico/táctico/técnico),
 *    meso/microciclo y los bloques con sus ejercicios.
 * `clone_session` YA fuerza `visibility='staff'` e `is_template=false` y NO copia la
 * fecha/equipo/evento de la plantilla (los toma de los parámetros = del evento), así
 * que no se arrastra nada indebido; el único paso extra es fijar el `event_id`.
 */
export async function planSessionForEventFromClient(
  supabase: DbClient,
  input: { clubId: string; eventId: string; templateId?: string | null },
): Promise<PlanSessionResult> {
  const { clubId, eventId } = input;
  const templateId = input.templateId ?? null;

  // Evento autoritativo: training de EQUIPO del club activo.
  const { data: ev } = await supabase
    .from('events')
    .select('starts_at, team_id, type, club_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev || ev.club_id !== clubId || ev.type !== 'training') return { id: null, error: 'invalid' };
  const teamId = (ev.team_id as string | null) ?? null;
  if (!teamId) return { id: null, error: 'invalid' };

  // ¿Ya hay sesión vinculada? (1:1) → devuélvela (idempotente).
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_template', false)
    .maybeSingle();
  if (existing?.id) return { id: existing.id as string };

  const sessionDate = sessionDateFromEventStart(ev.starts_at as string);

  // Camino 2 — desde plantilla: clona (hereda contenido) con equipo+fecha del evento
  // y luego vincula el event_id (clone_session no lo fija).
  if (templateId) {
    const { data: cloned, error: cloneErr } = await supabase.rpc('clone_session', {
      p_source_id: templateId,
      p_is_template: false,
      p_session_date: sessionDate,
      p_team_id: teamId,
    });
    if (cloneErr) return { id: null, error: mapErr(cloneErr.code) };
    const newId = (cloned as string | null) ?? null;
    if (!newId) return { id: null, error: 'generic' };

    const { data: linked, error: linkErr } = await supabase
      .from('sessions')
      .update({ event_id: eventId })
      .eq('id', newId)
      .eq('is_template', false)
      .is('event_id', null)
      .select('id')
      .maybeSingle();
    if (linkErr) return { id: null, error: linkErr.code === '23505' ? 'conflict' : mapErr(linkErr.code) };
    if (!linked) return { id: null, error: 'not_found' };
    return { id: newId };
  }

  // Camino 3 — en blanco: crea la cabecera (owner lo fuerza el trigger, pero el tipo
  // Insert exige owner_profile_id) + siembra el esqueleto de 5 bloques.
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { id: null, error: 'forbidden' };

  const { data: created, error: createErr } = await supabase
    .from('sessions')
    .insert({
      owner_profile_id: user.id,
      club_id: clubId,
      team_id: teamId,
      session_date: sessionDate,
      event_id: eventId,
    })
    .select('id')
    .maybeSingle();
  if (createErr) return { id: null, error: mapErr(createErr.code) };
  const id = created?.id as string | undefined;
  if (!id) return { id: null, error: 'generic' };

  const blocks = buildDefaultSkeleton().map((b) => ({
    session_id: id,
    club_id: clubId,
    block_type: b.block_type,
    order_idx: b.order_idx,
  }));
  const { error: blocksErr } = await supabase.from('session_blocks').insert(blocks);
  if (blocksErr) {
    // Limpieza best-effort: una sesión sin bloques no es usable.
    await supabase.from('sessions').delete().eq('id', id);
    return { id: null, error: mapErr(blocksErr.code) };
  }
  return { id };
}

/**
 * Guarda la cabecera desde el editor MÓVIL: SOLO nombre + objetivos. NO toca
 * meso/microciclo (no se editan en móvil → no se pisan), ni team/fecha/visibility.
 * La RLS (owner ∪ admin ∪ staff del equipo) es el gate.
 */
export async function updateSessionHeaderFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<{ ok: boolean; error?: SessionWriteError }> {
  const parsed = updateSessionHeaderMobileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const cols = toSessionHeaderMobileColumns(parsed.data);
  const { error } = await supabase.from('sessions').update(cols).eq('id', parsed.data.id);
  return error ? { ok: false, error: mapErr(error.code) } : { ok: true };
}

/**
 * Comparte/descomparte la sesión con el equipo vía el RPC `set_session_shared`
 * (#484: exige entrenamiento asignado para compartir; el RPC es el gate). Wrapper
 * cliente para el interruptor nativo.
 */
export async function setSessionSharedFromClient(
  supabase: DbClient,
  id: string,
  shared: boolean,
): Promise<{ ok: boolean; error?: SessionWriteError }> {
  const { error } = await supabase.rpc('set_session_shared', {
    p_session_id: id,
    p_shared: shared,
  });
  return error ? { ok: false, error: mapErr(error.code) } : { ok: true };
}
