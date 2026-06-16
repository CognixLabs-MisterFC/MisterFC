'use server';

import { revalidatePath } from 'next/cache';
import {
  createExerciseSchema,
  statusForAction,
  toExerciseColumns,
  createSupabaseServerClient,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

// ─────────────────────────────────────────────────────────────────────────────
// F11.6 — Crear ejercicio (flujo A: borrador + proponer; Admin publica directo).
// La RLS/trigger de 11.1 son el gate real; aquí hay pre-checks de autoridad para
// devolver errores claros antes de tocar la BD.
// ─────────────────────────────────────────────────────────────────────────────

type ActionError = 'forbidden' | 'invalid' | 'name_taken' | 'generic';

export type ExerciseActionState = {
  error?: ActionError;
  success?: boolean;
  id?: string;
};

function mapPgErr(code: string | undefined): ActionError {
  if (code === '42501') return 'forbidden'; // RLS
  if (code === '23505') return 'name_taken'; // colisión de nombre (si hubiera unique)
  return 'generic';
}

export async function createExercise(input: unknown): Promise<ExerciseActionState> {
  const parsed = createExerciseSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const isAdmin = (ctx.activeClub.role as Role) === 'admin_club';
  const status = statusForAction(parsed.data.action, isAdmin);
  if (status === null) return { error: 'forbidden' }; // p.ej. no-Admin pidiendo publicar

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // Pre-check de autoría (defensa en profundidad; la RLS de INSERT lo repite).
  const { data: canCreate } = await supabase.rpc('user_can_create_exercises', {
    p_club_id: clubId,
  });
  if (!canCreate) return { error: 'forbidden' };

  const columns = toExerciseColumns(parsed.data, status);

  const { data: created, error } = await supabase
    .from('exercises')
    .insert({
      owner_profile_id: ctx.user.id,
      club_id: clubId,
      ...columns,
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: mapPgErr(error.code) };
  const id = created?.id as string | undefined;
  if (!id) return { error: 'generic' };

  revalidatePath('/[locale]/(authenticated)/ejercicios', 'page');
  return { success: true, id };
}
