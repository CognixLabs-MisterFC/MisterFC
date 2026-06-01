'use server';

import { revalidatePath } from 'next/cache';
import {
  createCoachFormationSchema,
  updateCoachFormationSchema,
  deleteCoachFormationSchema,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F6.10 — CRUD de plantillas de formación personalizadas (coach_formations).
// ─────────────────────────────────────────────────────────────────────────────

type ActionError =
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'name_taken'
  | 'positions_invalid'
  | 'generic';

export type CoachFormationActionState = {
  error?: ActionError;
  success?: boolean;
  formationId?: string;
};

function mapPgErr(
  message: string | undefined,
  code: string | undefined,
): ActionError {
  if (code === '42501') return 'forbidden';
  if (code === '23505') return 'name_taken'; // unique (owner, format, name)
  if (!message) return 'generic';
  if (message.includes('positions_')) return 'positions_invalid';
  if (message.includes('position_')) return 'positions_invalid';
  return 'generic';
}

function revalidate() {
  revalidatePath('/[locale]/(authenticated)/perfil/formaciones', 'page');
}

export async function createFormation(
  input: unknown,
): Promise<CoachFormationActionState> {
  const parsed = createCoachFormationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { name, format, positions } = parsed.data;
  const { data: created, error } = await supabase
    .from('coach_formations')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: ctx.activeClub.club.id,
      name,
      format,
      positions,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.message, error.code) };
  const formationId = created?.id as string | undefined;
  if (!formationId) return { error: 'generic' };

  revalidate();
  return { success: true, formationId };
}

export async function updateFormation(
  input: unknown,
): Promise<CoachFormationActionState> {
  const parsed = updateCoachFormationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { id, name, format, positions } = parsed.data;
  const { data: updated, error } = await supabase
    .from('coach_formations')
    .update({ name, format, positions })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.message, error.code) };
  if (!updated) return { error: 'not_found' };

  revalidate();
  return { success: true, formationId: id };
}

export async function deleteFormation(
  input: unknown,
): Promise<CoachFormationActionState> {
  const parsed = deleteCoachFormationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { error } = await supabase
    .from('coach_formations')
    .delete()
    .eq('id', parsed.data.id);

  if (error) return { error: mapPgErr(error.message, error.code) };

  revalidate();
  return { success: true };
}
