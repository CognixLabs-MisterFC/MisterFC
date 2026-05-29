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
 * UPDATE plano sobre la fila pre-sembrada.
 *
 * El trigger `ensure_assistant_capabilities` (F1.4) siembra las N filas con
 * granted=false al crear una membership con role=entrenador_ayudante. La
 * migración F3.1 backfilleó `can_manage_calendar` para ayudantes existentes.
 * Por tanto la fila SIEMPRE existe; un UPSERT no aporta robustez real y sí
 * abre la ruta INSERT ... ON CONFLICT DO UPDATE, que PostgreSQL evalúa contra
 * la policy INSERT (inexistente en F1.7 hasta F3.2-fix). Resultado: el
 * `.upsert()` original fallaba con 42501 para todos los roles.
 *
 * La migración 20260530000002 añade defensa en profundidad (policy INSERT)
 * por si en el futuro se vuelve a UPSERT.
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

  const { error, count } = await supabase
    .from('capabilities')
    .update(
      { granted: parsed.data.granted },
      { count: 'exact' }
    )
    .eq('membership_id', parsed.data.membership_id)
    .eq('capability_name', parsed.data.capability_name);

  if (error) {
    if (error.code === '42501') return { success: false, error: 'forbidden' };
    return { success: false, error: 'db' };
  }

  // UPDATE con RLS USING que evalúa a false NO lanza error; deja rows=0. Eso
  // significa "permitido por RLS de SELECT pero no de UPDATE": reportamos
  // forbidden para que la UI no parezca que ha guardado.
  if ((count ?? 0) === 0) {
    return { success: false, error: 'forbidden' };
  }

  revalidatePath(
    `/[locale]/(authenticated)/equipos/${teamId}/staff/${membershipId}/capabilities`,
    'page'
  );
  return { success: true, granted: parsed.data.granted };
}
