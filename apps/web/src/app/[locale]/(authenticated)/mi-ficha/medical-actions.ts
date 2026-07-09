'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type MedicalFormState = { error?: 'forbidden' | 'generic'; success?: boolean };

/**
 * F14-4/F14-6 — El TUTOR gestiona (de forma continua) los 4 campos médicos de su
 * hijo. La ESCRITURA pasa OBLIGATORIAMENTE por la RPC `set_player_medical`
 * (SECURITY DEFINER): player_medical está cerrada al cliente (una sola puerta). La
 * RPC valida tutor + consentimiento de escritura vigente (RAISE forbidden si no) y
 * la auditoría medical.write la pone el trigger. El staff no llega aquí.
 */
export async function upsertPlayerMedical(
  playerId: string,
  _prev: MedicalFormState,
  formData: FormData
): Promise<MedicalFormState> {
  const field = (name: string): string | null => {
    const v = formData.get(name);
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
  };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('set_player_medical', {
    p_player_id: playerId,
    p_allergies: field('allergies'),
    p_medication: field('medication'),
    p_medical_conditions: field('medical_conditions'),
    p_emergency_contact: field('emergency_contact'),
  });

  if (error) {
    // La RPC lanza 'forbidden' si no es tutor o no hay consentimiento de escritura.
    return { error: (error.message ?? '').includes('forbidden') ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/mi-ficha', 'page');
  return { success: true };
}
