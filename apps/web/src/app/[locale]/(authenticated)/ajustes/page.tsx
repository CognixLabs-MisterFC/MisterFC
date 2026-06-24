import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Settings } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ClubSettingsForm } from './club-settings-form';
import { DeadlinesForm } from './deadlines-form';

type Props = {
  params: Promise<{ locale: string }>;
};

// Admin y coordinador ven la pantalla; SOLO admin puede cambiar el flag (D10).
const ALLOWED_ROLES = new Set(['admin_club', 'coordinador']);

export default async function AjustesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('ajustes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Sin fila en club_settings = OFF (privacidad por defecto, D4).
  const { data: settings } = await supabase
    .from('club_settings')
    .select('evaluations_player_visibility')
    .eq('club_id', ctx.activeClub.club.id)
    .maybeSingle();

  const visible = settings?.evaluations_player_visibility ?? false;
  const canEdit = ctx.activeClub.role === 'admin_club';

  // F13.10g — Temporada activa + fechas límite de evaluaciones por periodo.
  const { data: activeSeason } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', ctx.activeClub.club.id)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  let deadlinesInitial: Record<string, string> = {};
  if (activeSeason) {
    const { data: dls } = await supabase
      .from('assessment_deadlines')
      .select('period, due_date')
      .eq('season_id', activeSeason.id);
    deadlinesInitial = Object.fromEntries(
      (dls ?? []).map((d) => [d.period as string, (d.due_date as string) ?? '']),
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Settings className="size-7 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations_section.title')}</CardTitle>
          <CardDescription>{t('evaluations_section.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ClubSettingsForm initialVisible={visible} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('assessment_deadlines.title')}</CardTitle>
          <CardDescription>{t('assessment_deadlines.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {activeSeason ? (
            <DeadlinesForm
              seasonId={activeSeason.id}
              seasonLabel={activeSeason.label}
              initial={deadlinesInitial}
              canEdit={canEdit}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('assessment_deadlines.no_active_season')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
