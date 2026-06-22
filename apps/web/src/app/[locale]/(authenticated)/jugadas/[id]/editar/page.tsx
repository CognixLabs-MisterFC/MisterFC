import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { PlayEditor } from '../../_components/play-editor';
import { loadPlayForEdit } from '../../queries';

type Props = { params: Promise<{ locale: string; id: string }> };

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/** Borrar jugada = autor∪admin/coord (la RLS es el gate real; aquí solo el UI). */
const DELETE_ANY_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

/**
 * F13.2a — Editor de jugada. Carga cabecera + jsonb `play`; la RLS decide la
 * visibilidad (si no se ve → notFound). Guardar lo gatea la RLS (autor∪admin/coord).
 */
export default async function EditarJugadaPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('jugadas');
  const play = await loadPlayForEdit(ctx.activeClub.club.id, id);
  if (!play) notFound();

  const canDelete = DELETE_ANY_ROLES.includes(role) || play.is_owner;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link
        href="/jugadas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{t('edit_title')}</h1>
      <PlayEditor play={play} canDelete={canDelete} />
    </div>
  );
}
