/**
 * F13.10g-GB — Panel de Inicio: campañas de evaluación ABIERTAS con informes
 * pendientes. Server, rol-aware (la query decide la audiencia, molde 12.8b):
 * entrenadores ven sus equipos; admin/coord, el club; jugador/familia, nada. Si no
 * hay pendientes, no se muestra. Enlaza a "Mis equipos" para redactar.
 */

import { getTranslations } from 'next-intl/server';
import { ClipboardList } from 'lucide-react';
import { daysUntil, deadlineState } from '@misterfc/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { loadCampaignAlerts } from './campaign-alert-queries';

type Props = {
  role: string;
  clubId: string;
  membershipId: string;
  locale: string;
};

export async function CampaignAlertPanel({ role, clubId, membershipId, locale }: Props) {
  const alerts = await loadCampaignAlerts(role, clubId, membershipId);
  if (alerts.length === 0) return null;

  const t = await getTranslations('home.campaign_alert');
  const tPeriod = await getTranslations('informes.period');
  const todayMadrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(
    new Date(),
  );
  const fmtDate = (ymd: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/Madrid',
    }).format(new Date(`${ymd}T00:00:00Z`));

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4" aria-hidden />
          {t('title', { count: alerts.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="flex flex-col divide-y divide-border">
          {alerts.map((a) => {
            const left = daysUntil(a.dueDate, todayMadrid);
            const state = deadlineState(left);
            return (
              <li
                key={a.period}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {t('item', { period: tPeriod(a.period as 'inicial'), count: a.pending })}
                  </span>
                  <span
                    className={
                      state === 'overdue'
                        ? 'text-xs font-medium text-red-600 dark:text-red-400'
                        : state === 'soon'
                          ? 'text-xs font-medium text-amber-600 dark:text-amber-400'
                          : 'text-xs text-muted-foreground'
                    }
                  >
                    {state === 'overdue'
                      ? t('overdue', { date: fmtDate(a.dueDate) })
                      : t('due', { date: fmtDate(a.dueDate), days: Math.max(0, left) })}
                  </span>
                </div>
                <Link
                  href="/mis-equipos"
                  className="text-sm font-medium text-misterfc-green hover:underline"
                >
                  {t('cta')}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
