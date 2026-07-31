'use server';

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServerClient,
  setPlayerMedicalFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type MedicalFormState = { error?: 'forbidden' | 'generic'; success?: boolean };

/**
 * F14-4/F14-6 — El TUTOR gestiona (de forma continua) los 4 campos médicos de su
 * hijo. La ESCRITURA pasa OBLIGATORIAMENTE por la RPC `set_player_medical`
 * (SECURITY DEFINER): player_medical está cerrada al cliente (una sola puerta). La
 * RPC valida tutor + consentimiento de escritura vigente (RAISE forbidden si no) y
 * la auditoría medical.write la pone el trigger. El staff no llega aquí.
 *
 * O2-5 C2 — la invocación + normalización + mapeo de error viven en core
 * (`setPlayerMedicalFromClient`); aquí solo se lee el FormData y se revalida.
 */
export async function upsertPlayerMedical(
  playerId: string,
  _prev: MedicalFormState,
  formData: FormData
): Promise<MedicalFormState> {
  const field = (name: string): string | null => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await setPlayerMedicalFromClient(supabase, playerId, {
    allergies: field('allergies'),
    medication: field('medication'),
    medical_conditions: field('medical_conditions'),
    emergency_contact: field('emergency_contact'),
  });

  if ('ok' in res) {
    revalidatePath('/[locale]/(authenticated)/mi-ficha', 'page');
    return { success: true };
  }
  return { error: res.error };
}
