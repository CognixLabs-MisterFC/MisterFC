/**
 * F13.10g-GB — Centro de mando de campañas de evaluación (admin/coord), colgado de
 * Plantilla (card "Informes"). Selector de periodo + estado de la campaña +
 * configurar fecha/LANZAR (admin) + matriz de progreso club-wide (equipo →
 * entrenadores, completados/pendientes sobre el roster activo, D6).
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardList } from 'lucide-react';
import {
  ADMIN_ROLES,
  createSupabaseServerClient,
  isDevelopmentPeriod,
  type AssessmentCampaignStatus,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodSelect } from '../../equipos/[teamId]/informes/_components/period-select';
import { LaunchControls } from './launch-controls';
import { PublishAllButton } from './publish-all-button';
import {
  loadActiveSeason,
  loadCampaign,
  loadCampaignMatrix,
  type TeamProgress,
} from './queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
};

const ADMIN_LIKE = ADMIN_ROLES;

const STATUS_VARIANT: Record<
  AssessmentCampaignStatus | 'none',
  'outline' | 'secondary' | 'default'
> = {
  none: 'outline',
  draft: 'outline',
  launched: 'secondary',
  published: 'default',
};

export default async function CampaignCommandPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { period: periodParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!ADMIN_LIKE.includes(role)) redirect(`/${locale}`);
  const canEdit = role === 'admin_club';

  const t = await getTranslations('informes');
  const supabase = createSupabaseServerClient(await createCookieAdapter());
  const clubId = ctx.activeClub.club.id;

  const period = isDevelopmentPeriod(periodParam) ? periodParam : 'inicial';
  const season = await loadActiveSeason(supabase, clubId);

  const campaign = season ? await loadCampaign(supabase, season.id, period) : null;
  const matrix: TeamProgress[] = season
    ? await loadCampaignMatrix(supabase, clubId, season.label, season.id, period)
    : [];
  const status: AssessmentCampaignStatus | 'none' = campaign?.status ?? 'none';
  const totals = matrix.reduce(
    (acc, m) => ({ completed: acc.completed + m.completed, total: acc.total + m.total }),
    { completed: 0, total: 0 },
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="size-6" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('campaign.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('campaign.subtitle')}</p>
        </div>
      </div>

      {!season ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('campaign.no_active_season')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {season.label} ·{' '}
              {t('campaign.completed_of', { done: totals.completed, total: totals.total })}
            </p>
            <PeriodSelect current={period} label={t('period_label')} />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">{t(`period.${period}`)}</CardTitle>
              <Badge variant={STATUS_VARIANT[status]}>{t(`campaign.status.${status}`)}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <LaunchControls
                seasonId={season.id}
                period={period}
                locale={locale}
                initialDueDate={campaign?.dueDate ?? ''}
                status={(campaign?.status ?? 'draft') as 'draft' | 'launched' | 'published'}
                canEdit={canEdit}
              />
              {canEdit && status === 'launched' && (
                <div className="flex flex-col gap-1 border-t border-border pt-3">
                  <PublishAllButton
                    seasonId={season.id}
                    period={period}
                    locale={locale}
                    completed={totals.completed}
                    pending={totals.total - totals.completed}
                  />
                  <p className="text-xs text-muted-foreground">{t('campaign.publish_all_hint')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaign.col_team')}</TableHead>
                    <TableHead>{t('campaign.col_coaches')}</TableHead>
                    <TableHead className="text-right">{t('campaign.col_progress')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        {t('campaign.no_teams')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    matrix.map((m) => {
                      const pct = m.total === 0 ? 0 : Math.round((m.completed / m.total) * 100);
                      const done = m.total > 0 && m.completed === m.total;
                      return (
                        <TableRow key={m.teamId}>
                          <TableCell className="font-medium">{m.teamName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.coaches.length > 0 ? m.coaches.join(', ') : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-sm tabular-nums text-muted-foreground">
                                {m.completed}/{m.total}
                              </span>
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={done ? 'h-full bg-emerald-500' : 'h-full bg-misterfc-green'}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
