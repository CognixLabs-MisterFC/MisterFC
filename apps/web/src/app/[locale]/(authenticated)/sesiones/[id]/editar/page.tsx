import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  loadSessionForEdit,
  loadClubTeams,
  loadPickableExercises,
  loadAddablePlaysForSession,
} from '../../queries';
import { SessionEditor } from '../../_components/session-editor';

type Props = { params: Promise<{ locale: string; id: string }> };

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * F12.2 — Editor de sesión. Carga cabecera + bloques (sembrados) + tareas; la RLS
 * decide la visibilidad (si no se ve → notFound). Editar la cabecera lo gatea la
 * RLS (owner∪admin); el formulario es para staff.
 */
export default async function EditarSesionPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const clubId = ctx.activeClub.club.id;
  const [session, teams, pickable] = await Promise.all([
    loadSessionForEdit(clubId, id),
    loadClubTeams(clubId),
    loadPickableExercises(clubId),
  ]);
  if (!session) notFound();

  // JS-1 — playbook del equipo de la sesión para el picker de jugadas (D4: [] si no
  // hay equipo). Carga tras resolver la sesión (necesita su team_id).
  const addablePlays = await loadAddablePlaysForSession(clubId, session.team_id, '', []);

  const t = await getTranslations('sesiones');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link
        href="/sesiones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{t('edit_title')}</h1>
      <SessionEditor
        session={session}
        teams={teams}
        pickable={pickable}
        addablePlays={addablePlays}
      />
    </div>
  );
}
