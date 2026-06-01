import {
  createSupabaseServerClient,
  type CoachFormation,
  type CoachFormationPosition,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// F6.10 — Lectura de plantillas de formación del coach.
//
// La RLS de coach_formations ya restringe SELECT al dueño (+ admin/coord del
// club). Para "Mis formaciones" filtramos además por owner = usuario actual,
// de modo que admin/coord vean SOLO las suyas en su propio /perfil/formaciones.
// ─────────────────────────────────────────────────────────────────────────────

type FormationRow = {
  id: string;
  name: string;
  format: string;
  positions: unknown;
};

function toCoachFormation(row: FormationRow): CoachFormation {
  return {
    id: row.id,
    name: row.name,
    format: row.format as TeamFormat,
    positions: (row.positions as CoachFormationPosition[]) ?? [],
  };
}

/**
 * Formaciones del usuario actual, ordenadas por modalidad y nombre. Si se pasa
 * `format`, filtra por esa modalidad (lo usa el selector del editor de
 * alineación, que solo ofrece las de la modalidad del equipo).
 */
export async function getMyFormations(
  format?: TeamFormat,
): Promise<CoachFormation[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('coach_formations')
    .select('id, name, format, positions')
    .eq('owner_profile_id', user.id);
  if (format) query = query.eq('format', format);

  const { data, error } = await query
    .order('format', { ascending: true })
    .order('name', { ascending: true });
  if (error || !data) return [];

  return (data as FormationRow[]).map(toCoachFormation);
}
