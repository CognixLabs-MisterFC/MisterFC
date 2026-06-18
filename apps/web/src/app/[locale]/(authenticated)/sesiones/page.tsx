import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { type Role, createSupabaseServerClient } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = { params: Promise<{ locale: string }> };

// Staff del club; la autoría real la decide user_can_create_sessions + RLS.
const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * F12.2 — Landing de Sesiones. En 12.2a solo ofrece "Nueva sesión"; el listado y
 * la vista semana llegan en 12.3. La tarjeta "Sesiones" del hub Entrenamientos
 * enlaza aquí.
 */
export default async function SesionesPage({ params }: Props) {
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/sesiones/nueva">
              <Plus className="size-4" aria-hidden />
              {t('new')}
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('list_coming_soon')}
        </CardContent>
      </Card>
    </div>
  );
}
