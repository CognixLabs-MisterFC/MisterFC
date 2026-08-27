import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { MembersScreen, type Segment } from './_components/members-screen';
import {
  loadClubMembers,
  countFamilies,
  loadFamilies,
  loadAssignableTeams,
} from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    segment?: string;
    q?: string;
    page?: string;
    bajas?: string;
  }>;
};

// Baja de miembros (4e-1/4e-3) — pantalla de gestión: SOLO admin_club y director (A2).
// El coordinador NO entra. Guard server-side además del nav (defensa en profundidad).
const ALLOWED_ROLES: readonly Role[] = ['admin_club', 'director'];
const SEGMENTS: readonly Segment[] = ['direccion', 'cuerpo_tecnico', 'familias'];

export default async function MiembrosPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_ROLES.includes(role)) {
    redirect(`/${locale}`);
  }

  const segment: Segment = SEGMENTS.includes(sp.segment as Segment)
    ? (sp.segment as Segment)
    : 'direccion';
  const includeLeft = sp.bajas === '1';
  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const clubId = ctx.activeClub.club.id;
  const t = await getTranslations('miembros');

  // Dirección y cuerpo técnico son pequeños → siempre; el contador de Familias es un
  // head-count barato. Lo PESADO (hijos+equipo) solo se hidrata si el segmento activo
  // es Familias (y solo de la página).
  const [members, familiesCount] = await Promise.all([
    loadClubMembers(clubId, includeLeft),
    countFamilies(clubId, includeLeft),
  ]);
  const families =
    segment === 'familias'
      ? await loadFamilies(clubId, { search, page, includeLeft })
      : null;
  // Equipos para el diálogo "Asignar a equipo" (director-entrenador S1a): solo se
  // necesitan en el segmento DIRECCIÓN, donde vive la acción.
  const assignableTeams =
    segment === 'direccion' ? await loadAssignableTeams(clubId) : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <MembersScreen
        segment={segment}
        includeLeft={includeLeft}
        direccion={members.direccion}
        cuerpoTecnico={members.cuerpoTecnico}
        familiesCount={familiesCount}
        families={families}
        assignableTeams={assignableTeams}
        viewerRole={role}
        viewerProfileId={ctx.user.id}
      />
    </div>
  );
}
