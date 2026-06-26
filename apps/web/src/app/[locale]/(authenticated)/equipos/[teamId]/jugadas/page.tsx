/**
 * JR-2 (ADR-0019) — Playbook del equipo: el staff del equipo selecciona jugadas
 * PUBLICADAS del banco del club hacia su equipo y decide cuáles comparte con la
 * familia. Vive como sub-página de equipo (junto a Informes/Anuncios). La RLS de
 * team_plays (JR-0) es el gate real; aquí se gatea la UI por user_is_staff_of_team
 * (admin/coord que no son staff del equipo VEN en solo lectura, no mutan).
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { PlaysSearchInput } from '../../../jugadas/_components/plays-search-input';
import {
  loadTeamSelectedPlays,
  loadAddablePublishedPlays,
  ADDABLE_PLAYS_LIMIT,
} from '../../../jugadas/queries';
import { TeamPlaybookManager } from './_components/team-playbook-manager';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
  searchParams: Promise<{ q?: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function TeamPlaybookPage({ params, searchParams }: Props) {
  const { locale, teamId } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!STAFF_ROLES.includes(ctx.activeClub.role as Role)) redirect(`/${locale}`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const clubId = ctx.activeClub.club.id;

  // El equipo debe ser del club activo.
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, season, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) notFound();
  const category = team.categories as unknown as { club_id: string };
  if (category.club_id !== clubId) notFound();

  // Gestionar (añadir/quitar/compartir) = staff de ESTE equipo (= RLS de team_plays).
  const { data: isStaff } = await supabase.rpc('user_is_staff_of_team', { p_team_id: teamId });
  const canManage = isStaff === true;

  const t = await getTranslations('playbook_equipo');
  const search = (sp.q ?? '').trim();

  const selected = await loadTeamSelectedPlays(teamId);
  const addable = canManage ? await loadAddablePublishedPlays(clubId, teamId, search) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/equipos/${teamId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-col">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {team.name as string} · {t('subtitle')}
        </p>
      </div>

      {canManage && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t('add.search_hint')}</p>
          <PlaysSearchInput />
        </div>
      )}

      <TeamPlaybookManager
        teamId={teamId}
        canManage={canManage}
        selected={selected}
        addable={addable}
        addableTruncated={addable.length >= ADDABLE_PLAYS_LIMIT}
      />
    </div>
  );
}
