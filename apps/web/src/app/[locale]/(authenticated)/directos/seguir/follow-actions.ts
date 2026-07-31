'use server';

/**
 * F7B-P1 — Seguir / dejar de seguir un equipo. O2-5 B1: la escritura se extrajo a
 * core (`setTeamFollowFromClient`); este server action mantiene la validación zod
 * y delega. Comportamiento idéntico.
 */

import { z } from 'zod';
import {
  createSupabaseServerClient,
  setTeamFollowFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

const schema = z.object({
  team_id: z.string().uuid(),
  follow: z.boolean(),
});

export type SetFollowState = { ok: true; following: boolean } | { error: string };

export async function setTeamFollow(input: unknown): Promise<SetFollowState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const res = await setTeamFollowFromClient(
    supabase,
    parsed.data.team_id,
    parsed.data.follow,
  );
  return 'error' in res ? { error: res.error } : res;
}
