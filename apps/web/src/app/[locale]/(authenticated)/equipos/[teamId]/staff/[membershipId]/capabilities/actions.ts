'use server';

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  updateCapabilitySchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CapabilityActionResult =
  | { success: true; granted: boolean }
  | {
      success: false;
      error: 'forbidden' | 'not_assistant' | 'invalid_input' | 'db';
    };

/**
 * UPSERT en lugar de UPDATE: cubre el caso (poco probable) de que la fila
 * sembrada por el trigger `ensure_assistant_capabilities` no exista. RLS
 * sigue siendo la autoridad real: si el user no es admin/coord/principal del
 * club al que pertenece la membership, la operación falla en BD.
 */
export async function toggleCapability(
  teamId: string,
  membershipId: string,
  capabilityName: string,
  granted: boolean
): Promise<CapabilityActionResult> {
  const parsed = updateCapabilitySchema.safeParse({
    membership_id: membershipId,
    capability_name: capabilityName,
    granted,
  });
  if (!parsed.success) return { success: false, error: 'invalid_input' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Verificar que el membership es entrenador_ayudante (las caps solo aplican
  // a este rol). RLS de SELECT en memberships permite ver miembros del club.
  const { data: m } = await supabase
    .from('memberships')
    .select('role')
    .eq('id', parsed.data.membership_id)
    .maybeSingle();
  if (!m) return { success: false, error: 'forbidden' };
  if (m.role !== 'entrenador_ayudante') {
    return { success: false, error: 'not_assistant' };
  }

  const { error } = await supabase.from('capabilities').upsert(
    {
      membership_id: parsed.data.membership_id,
      capability_name: parsed.data.capability_name,
      granted: parsed.data.granted,
    },
    { onConflict: 'membership_id,capability_name' }
  );

  if (error) {
    if (error.code === '42501') return { success: false, error: 'forbidden' };
    return { success: false, error: 'db' };
  }

  revalidatePath(
    `/[locale]/(authenticated)/equipos/${teamId}/staff/${membershipId}/capabilities`,
    'page'
  );
  return { success: true, granted: parsed.data.granted };
}
