import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  STAFF_ROLES,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { ImportWizard } from './import-wizard';

type Props = { params: Promise<{ locale: string }> };

const ROLES_ALLOWED = STAFF_ROLES;

/**
 * Página del wizard de importación masiva (F2.9).
 *
 * Role gate:
 *  - admin_club / coordinador / entrenador_principal → siempre.
 *  - entrenador_ayudante → solo si tiene `can_manage_squad` granted.
 *  - jugador → no.
 *
 * El gate se ejecuta también en la server action (defense in depth) — la RLS
 * de `players` y `team_members` lo confirma a nivel de BD.
 */
export default async function ImportPlayersPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role;
  if (!ROLES_ALLOWED.includes(role)) redirect(`/${locale}`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (role === 'entrenador_ayudante') {
    const { data: cap } = await supabase
      .from('capabilities')
      .select('granted')
      .eq('membership_id', ctx.activeClub.membershipId)
      .eq('capability_name', 'can_manage_squad')
      .maybeSingle();
    if (!cap?.granted) redirect(`/${locale}`);
  }

  // Rework A (A5) — los equipos son por temporada. Tanto el selector de lote como
  // la resolución de "equipo por fila" operan sobre la TEMPORADA ACTIVA del club
  // (Rework C/C5: la activa de seasons, no el reloj).
  const season = await getActiveSeasonLabel(supabase, ctx.activeClub.club.id);
  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, categories!inner(name)')
    .eq('club_id', ctx.activeClub.club.id)
    .eq('season', season)
    .order('name', { ascending: true });
  const teams = (teamsData ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category_name: (t.categories as unknown as { name: string }).name,
  }));

  // Jugadores existentes (solo claves para el dedup en cliente). Tope 5000
  // para que el payload no se dispare en clubs grandes.
  const { data: existingData } = await supabase
    .from('players')
    .select('id, first_name, last_name, date_of_birth')
    .eq('club_id', ctx.activeClub.club.id)
    .limit(5000);
  const existing = (existingData ?? []) as Array<{
    id: string;
    first_name: string;
    /** Nullable per F2.9 hotfix 2026-05-30. */
    last_name: string | null;
    date_of_birth: string;
  }>;

  const t = await getTranslations('import');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ImportWizard
        locale={locale}
        teams={teams}
        existing={existing}
        activeSeason={season}
      />
    </div>
  );
}
