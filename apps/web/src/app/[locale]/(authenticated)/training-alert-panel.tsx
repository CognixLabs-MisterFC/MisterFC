/**
 * F12.8b — Panel de Inicio: entrenamientos <48h SIN sesión planificada.
 *
 * Server component, rol-aware (la audiencia la decide la query, D4): cuerpo
 * técnico ve sus equipos; admin/coord, todo el club; jugador/familia, nada. Si no
 * hay ninguno, el panel no se muestra. Cada fila enlaza al flujo "Planificar
 * sesión" (crear nueva o vincular una existente) vía PlanSessionDialog.
 */

import { getTranslations } from 'next-intl/server';
import { CalendarClock } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PlanSessionDialog } from './calendario/_components/plan-session-dialog';
import { loadTrainingsWithoutSession } from './training-alert-queries';

function fmtDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

type Props = {
  role: string;
  clubId: string;
  membershipId: string;
  locale: string;
};

export async function TrainingAlertPanel({
  role,
  clubId,
  membershipId,
  locale,
}: Props) {
  const trainings = await loadTrainingsWithoutSession(role, clubId, membershipId);
  if (trainings.length === 0) return null;

  const t = await getTranslations('home.training_alert');

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" aria-hidden />
          {t('title', { count: trainings.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{t('desc')}</p>
        <ul className="flex flex-col divide-y divide-border">
          {trainings.map((tr) => (
            <li
              key={tr.eventId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="flex flex-col">
                <span className="font-medium">{tr.title}</span>
                <span className="text-xs text-muted-foreground">
                  {tr.teamName ? `${tr.teamName} · ` : ''}
                  {fmtDate(tr.startsAt, locale)}
                </span>
              </div>
              <PlanSessionDialog eventId={tr.eventId} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
