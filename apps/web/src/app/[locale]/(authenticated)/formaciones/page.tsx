import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getMyFormations } from './queries';
import { FormationsManager } from './_components/formations-manager';

type Props = { params: Promise<{ locale: string }> };

export default async function FormacionesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('formaciones');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // Bug BB — mismo criterio que la RLS INSERT (admin/coord, principal de team,
  // o staff con capability), no solo la capability suelta.
  const { data: canCreate } = await supabase.rpc(
    'user_can_create_coach_formations',
    { p_club_id: ctx.activeClub.club.id },
  );

  const formations = await getMyFormations();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <FormationsManager formations={formations} canCreate={canCreate === true} />
    </div>
  );
}
