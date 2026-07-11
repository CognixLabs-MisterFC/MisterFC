'use server';

import { createSupabaseServerClient, getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/**
 * F14B-7 — Server action de la consola: el superadmin crea un club vacío.
 *
 * Envuelve el backend F14B-5a:
 *   1. Gate is_superadmin() (server-side; las RPC lo reimponen).
 *   2. platform_propose_slug — el sistema propone un slug ÚNICO a partir del
 *      nombre (la UI muestra un preview con nameToSlug, pero la unicidad la
 *      decide esta RPC al enviar).
 *   3. platform_create_club — crea el club (dispara seed de legal_documents y
 *      categorías; owner_profile_id queda NULL hasta que el admin invitado
 *      acepte, F14B-5b).
 *
 * NO crea membership del superadmin. Devuelve el id del club para que la UI
 * refresque la lista.
 */

const LOCALES = ['es', 'en', 'va'] as const;
type ClubLocale = (typeof LOCALES)[number];

export type CreateClubFormState = {
  ok?: { clubId: string };
  error?: 'no_session' | 'forbidden' | 'name_required' | 'slug_taken' | 'generic';
};

function mapRpcError(message: string | undefined): CreateClubFormState['error'] {
  const m = message ?? '';
  if (m.includes('no_session')) return 'no_session';
  if (m.includes('forbidden')) return 'forbidden';
  if (m.includes('invalid_name')) return 'name_required';
  if (m.includes('slug_taken')) return 'slug_taken';
  return 'generic';
}

export async function createClub(
  _locale: string,
  _prev: CreateClubFormState,
  formData: FormData,
): Promise<CreateClubFormState> {
  const name = String(formData.get('name') ?? '').trim();
  const rawLocale = String(formData.get('club_locale') ?? 'es');
  const clubLocale: ClubLocale = (LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as ClubLocale)
    : 'es';

  if (name.length === 0 || name.length > 120) return { error: 'name_required' };

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) return { error: 'no_session' };

  const supabase = createSupabaseServerClient(adapter);

  // Gate server-side (las RPC lo reimponen de todos modos).
  const { data: isSuper } = await supabase.rpc('is_superadmin');
  if (isSuper !== true) return { error: 'forbidden' };

  // 1) Slug único propuesto por el backend.
  const { data: proposedSlug, error: slugErr } = await supabase.rpc('platform_propose_slug', {
    p_name: name,
  });
  if (slugErr || !proposedSlug) {
    console.error('[platform][create-club] propose_slug_failed', {
      error: slugErr?.message,
    });
    return { error: mapRpcError(slugErr?.message) };
  }

  // 2) Crear el club con el slug propuesto.
  const { data: clubId, error: createErr } = await supabase.rpc('platform_create_club', {
    p_name: name,
    p_slug: proposedSlug,
    p_locale: clubLocale,
  });
  if (createErr || !clubId) {
    console.error('[platform][create-club] create_failed', {
      slug: proposedSlug,
      error: createErr?.message,
    });
    return { error: mapRpcError(createErr?.message) };
  }

  return { ok: { clubId } };
}
