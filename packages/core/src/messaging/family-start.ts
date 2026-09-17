import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * La familia abre un hilo (migración 20261076000000).
 *
 * POR QUÉ ESTO NO ES UN `insert`. `conversations_insert_coach` exige
 * `coach_profile_id = auth.uid()`: solo el lado del club puede crear la fila. La
 * regla de a quién puede escribir una familia —dirección del club, y cualquiera
 * asignado a SU equipo— es demasiado específica para un `WITH CHECK`, así que vive
 * en dos RPC `SECURITY DEFINER`, y aquí solo se llaman.
 *
 * LAS DOS VAN JUNTAS A PROPÓSITO: `family_start_conversation` valida contra la MISMA
 * lista que devuelve `family_conversation_recipients`. Si el cliente se inventara una
 * lista propia, lo que se ofrece y lo que se permite podrían separarse — y el que se
 * separa siempre es el que se ve, no el que manda.
 */
type DbClient = SupabaseClient<Database>;

/** Un destinatario permitido para la familia de un jugador. */
export type FamilyRecipient = {
  profileId: string;
  fullName: string | null;
  /** 'club' = admin/dirección · 'team' = asignado a su equipo. */
  kind: 'club' | 'team';
  /** El rol concreto: el de membership en 'club', el de team_staff en 'team'. */
  staffRole: string;
  teamId: string | null;
  teamName: string | null;
  /** `null` = todavía no hay hilo con esta persona. Decide ABRIR o CREAR. */
  conversationId: string | null;
};

export type FamilyRecipientsResult =
  | { ok: true; recipients: FamilyRecipient[] }
  | { ok: false; reason: 'forbidden' | 'no_session' | 'error' };

export type StartFamilyConversationResult =
  | { ok: true; conversationId: string }
  | { ok: false; reason: 'forbidden' | 'no_session' | 'error' };

/**
 * Tres motivos y no dos, por lo mismo que el contacto de los tutores: una lista vacía
 * es una respuesta LEGÍTIMA —un club sin dirección y un jugador sin equipo no tienen
 * a quién escribir— y colapsarla con un fallo de lectura convierte un error en un
 * «aquí no hay nadie» que nadie va a investigar.
 */
function reasonOf(message: string | undefined): 'forbidden' | 'no_session' | 'error' {
  if (message?.includes('no_session')) return 'no_session';
  if (message?.includes('forbidden')) return 'forbidden';
  return 'error';
}

export async function getFamilyRecipientsFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<FamilyRecipientsResult> {
  const { data, error } = await supabase.rpc('family_conversation_recipients', {
    p_player_id: playerId,
  });

  if (error) return { ok: false, reason: reasonOf(error.message) };

  const recipients: FamilyRecipient[] = (data ?? []).map((row) => ({
    profileId: row.profile_id,
    fullName: row.full_name ?? null,
    // El `kind` lo fija el SQL ('club' | 'team'); se estrecha aquí sin inventarlo:
    // cualquier otra cosa sería un cambio de la RPC, y entonces queremos verlo.
    kind: row.kind === 'club' ? 'club' : 'team',
    staffRole: row.staff_role,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
    conversationId: row.conversation_id ?? null,
  }));

  return { ok: true, recipients };
}

/**
 * Abre el hilo, o devuelve el que ya hay. Idempotente en el servidor por el
 * `UNIQUE (coach_profile_id, player_id)`, así que dos toques seguidos en el mismo
 * nombre devuelven el mismo hilo y no dos.
 *
 * NO escribe ningún mensaje: crear el hilo y enviar son cosas distintas. Si el envío
 * fallara, la familia se queda con un hilo vacío y no con un mensaje perdido.
 */
export async function startFamilyConversationFromClient(
  supabase: DbClient,
  playerId: string,
  recipientProfileId: string,
): Promise<StartFamilyConversationResult> {
  const { data, error } = await supabase.rpc('family_start_conversation', {
    p_player_id: playerId,
    p_recipient_profile_id: recipientProfileId,
  });

  if (error) return { ok: false, reason: reasonOf(error.message) };
  if (!data) return { ok: false, reason: 'error' };
  return { ok: true, conversationId: data as string };
}
