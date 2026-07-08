'use server';

/**
 * F7B-P1 — Seguir / dejar de seguir un equipo. Escribe team_follows con el
 * cliente RLS del usuario: solo puede tocar sus propias filas y solo equipos de
 * su club (la policy with-check lo garantiza). Insert idempotente / delete.
 */

import { z } from 'zod';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const schema = z.object({
  team_id: z.string().uuid(),
  follow: z.boolean(),
});

export type SetFollowState = { ok: true; following: boolean } | { error: string };

export async function setTeamFollow(input: unknown): Promise<SetFollowState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };
  const { team_id, follow } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  if (follow) {
    const { error } = await supabase
      .from('team_follows')
      .upsert(
        { profile_id: user.id, team_id },
        { onConflict: 'profile_id,team_id', ignoreDuplicates: true },
      );
    // La with-check bloquea equipos de otro club → error de RLS.
    if (error) return { error: 'forbidden' };
    return { ok: true, following: true };
  }

  const { error } = await supabase
    .from('team_follows')
    .delete()
    .eq('profile_id', user.id)
    .eq('team_id', team_id);
  if (error) return { error: 'generic' };
  return { ok: true, following: false };
}
