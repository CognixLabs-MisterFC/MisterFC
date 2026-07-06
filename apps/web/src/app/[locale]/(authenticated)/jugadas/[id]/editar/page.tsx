import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role, STAFF_ROLES, ADMIN_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { PlayEditor } from '../../_components/play-editor';
import { loadPlayForEdit, userCanCreatePlays } from '../../queries';

type Props = { params: Promise<{ locale: string; id: string }> };

/** Aprobar/archivar = admin∪coordinador (= user_can_approve_plays, D1). */
const APPROVER_ROLES: ReadonlyArray<Role> = ADMIN_ROLES;

/**
 * JR-1 (ADR-0019) — Editor de jugada del banco del club + ciclo de aprobación en la
 * cabecera. Carga cabecera + jsonb `play` + estado; la RLS decide la visibilidad
 * (si no se ve → notFound). Editar contenido lo gatea la RLS (autor de no-publicada
 * ∪ aprobador); las transiciones (proponer/aprobar/rechazar/archivar) van por las
 * acciones de ciclo. El editor de frames/animación no cambia.
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

  const isApprover = APPROVER_ROLES.includes(role);
  const isOwner = play.is_owner;
  // Editar contenido = mirror de la RLS UPDATE de JR-0: aprobador, o autor de una
  // jugada NO publicada. Una publicada solo la edita en sitio el aprobador.
  const canEdit = isApprover || (isOwner && play.status !== 'published');
  // Borrar = autor∪aprobador de NO publicada (las publicadas se archivan).
  const canDelete = (isApprover || isOwner) && play.status !== 'published';
  // "Proponer cambios": salida para el no-aprobador que NO puede editar en sitio una
  // jugada PUBLICADA pero SÍ puede crear jugadas (p.ej. el principal). Crea una copia
  // 'proposed' para revisión; la original no se toca. Solo consultamos el helper en
  // ese caso concreto (evita un RPC en cada apertura del editor).
  const canPropose =
    !canEdit &&
    play.status === 'published' &&
    (await userCanCreatePlays(ctx.activeClub.club.id));

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
      <PlayEditor
        play={play}
        canDelete={canDelete}
        canEdit={canEdit}
        canPropose={canPropose}
        isOwner={isOwner}
        isApprover={isApprover}
      />
    </div>
  );
}
