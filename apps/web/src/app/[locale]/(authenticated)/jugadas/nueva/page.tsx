import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role, STAFF_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { NuevaJugadaForm } from '../_components/nueva-jugada-form';

type Props = { params: Promise<{ locale: string }> };


/**
 * JR-1 (ADR-0019) — Alta de jugada (borrador del club). Solo staff. El gate real de
 * creación (club-scoped) lo aplica `createPlay` (RLS/`user_can_create_plays`); aquí
 * no se muta en el GET.
 */
export default async function NuevaJugadaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('jugadas');

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
      <NuevaJugadaForm />
    </div>
  );
}
