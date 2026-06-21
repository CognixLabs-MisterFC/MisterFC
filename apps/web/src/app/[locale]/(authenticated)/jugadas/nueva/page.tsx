import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { NuevaJugadaForm } from '../_components/nueva-jugada-form';
import { loadClubTeams } from '../queries';

type Props = { params: Promise<{ locale: string }> };

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * F13.2a — Alta de jugada. Solo staff. El gate real de creación (per-team) lo
 * aplica `createPlay` (RLS/`user_can_create_plays`); aquí no se muta en el GET.
 */
export default async function NuevaJugadaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('jugadas');
  const teams = await loadClubTeams(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link
        href="/jugadas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{t('new_title')}</h1>
      <NuevaJugadaForm teams={teams} />
    </div>
  );
}
