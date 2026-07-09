'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type MedicalFormState = { error?: 'forbidden' | 'generic'; success?: boolean };

/**
 * F14-4 — El TUTOR gestiona (de forma continua) los 4 campos médicos de su hijo.
 * Escribe bajo su sesión: la RLS de player_medical exige user_is_tutor_of_player
 * Y consentimiento vigente. El staff NO llega aquí (no es tutor). upsert por
 * player_id; updated_by/updated_at los pone el trigger player_medical_touch.
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

  const { error } = await supabase.from('player_medical').upsert(
    {
      player_id: playerId,
      allergies: field('allergies'),
      medication: field('medication'),
      medical_conditions: field('medical_conditions'),
      emergency_contact: field('emergency_contact'),
    },
    { onConflict: 'player_id' }
  );

  if (error) {
    // 42501 = RLS: no es tutor o no hay consentimiento vigente.
    return { error: error.code === '42501' ? 'forbidden' : 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/mi-ficha', 'page');
  return { success: true };
}
