import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Ban } from 'lucide-react';
import { type Role, createSupabaseServerClient } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { loadClubTeams } from '../queries';
import { NuevaSesionForm } from '../_components/nueva-sesion-form';

type Props = { params: Promise<{ locale: string }> };

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * F12.2 — "Nueva sesión": alta mínima (equipo + fecha) → crea + siembra el
 * esqueleto + redirige al editor. Gating can_create_sessions (RPC) al cargar
 * (defensa en profundidad; la RLS es el gate real).
 */
export default async function NuevaSesionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('sesiones');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: canCreate } = await supabase.rpc('user_can_create_sessions', {
    p_club_id: ctx.activeClub.club.id,
  });

  if (!canCreate) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Link
          href="/sesiones"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('back')}
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Ban className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('forbidden')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const teams = await loadClubTeams(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link
        href="/sesiones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{t('new_title')}</h1>
      <NuevaSesionForm teams={teams} />
    </div>
  );
}
