import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  ClipboardList,
  GraduationCap,
  Megaphone,
  ClipboardCheck,
  Mail,
  ShieldAlert,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadTrainingsWithoutSession } from './training-alert-queries';
import { loadCampaignAlerts } from './campaign-alert-queries';
import {
  resolveFilterTeamIds,
  loadFilterOptions,
  loadPendingCallups,
  loadTrainingsWithoutAttendance,
  loadPendingInvitationsCount,
  loadPendingErasureCount,
  type DireccionTaskItem,
} from './direccion-home-queries';
import { DireccionFilters } from './direccion-filters';

type Props = {
  role: string;
  clubId: string;
  membershipId: string;
  isAdminClub: boolean;
  locale: string;
  filters: { teamId?: string; coachMembershipId?: string };
};

/**
 * F14E-2 — Inicio de DIRECCIÓN (admin_club/director). Surfacea club-wide las
 * tareas pendientes de los entrenadores (mismo contenido que su Inicio) con
 * filtros por equipo/entrenador, más las tareas de gestión (invitaciones,
 * supresiones). Sin chat ni dashboard embebido.
 */
export async function DireccionHome({
  role,
  clubId,
  membershipId,
  isAdminClub,
  locale,
  filters,
}: Props) {
  const t = await getTranslations('home');

  const [{ teams, coaches }, filterTeamIds] = await Promise.all([
    loadFilterOptions(clubId),
    resolveFilterTeamIds(filters),
  ]);

  const [
    trainingsNoSession,
    campaigns,
    pendingCallups,
    trainingsNoAttendance,
    invitations,
    erasure,
  ] = await Promise.all([
    loadTrainingsWithoutSession(role, clubId, membershipId, filterTeamIds),
    loadCampaignAlerts(role, clubId, membershipId, filterTeamIds),
    loadPendingCallups(clubId, filterTeamIds),
    loadTrainingsWithoutAttendance(clubId, filterTeamIds),
    loadPendingInvitationsCount(clubId),
    isAdminClub ? loadPendingErasureCount(clubId) : Promise.resolve(0),
  ]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(locale);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{t('direccion.tasks_title')}</h2>
        <DireccionFilters
          teams={teams}
          coaches={coaches}
          activeTeamId={filters.teamId ?? ''}
          activeCoachId={filters.coachMembershipId ?? ''}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TaskCard
          icon={<GraduationCap className="size-4" aria-hidden />}
          title={t('direccion.trainings_no_session')}
          items={trainingsNoSession.map((e) => ({ ...e }))}
          empty={t('direccion.empty')}
          fmt={fmt}
        />
        <TaskCard
          icon={<ClipboardCheck className="size-4" aria-hidden />}
          title={t('direccion.trainings_no_attendance')}
          items={trainingsNoAttendance}
          empty={t('direccion.empty')}
          fmt={fmt}
          hrefFor={(e) => `/asistencia/${e.eventId}`}
        />
        <TaskCard
          icon={<Megaphone className="size-4" aria-hidden />}
          title={t('direccion.pending_callups')}
          items={pendingCallups}
          empty={t('direccion.empty')}
          fmt={fmt}
          hrefFor={() => `/convocatorias`}
        />
        {/* C — campañas: agregado por periodo (no por equipo). */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4" aria-hidden />
              {t('direccion.pending_reports')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {campaigns.length === 0 ? (
              <p className="text-muted-foreground">{t('direccion.empty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {campaigns.map((c) => (
                  <li key={c.period} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium">{c.period}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('direccion.reports_pending', { count: c.pending })}
                      {' · '}
                      {new Date(c.dueDate).toLocaleDateString(locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tareas de gestión propias */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ManagementCard
          icon={<Mail className="size-4" aria-hidden />}
          title={t('direccion.pending_invitations')}
          count={invitations}
          href="/invitations"
          cta={t('direccion.pending_invitations_cta', { count: invitations })}
          empty={t('direccion.empty')}
        />
        {isAdminClub && (
          <ManagementCard
            icon={<ShieldAlert className="size-4" aria-hidden />}
            title={t('direccion.pending_erasure')}
            count={erasure}
            href="/supresiones"
            cta={t('direccion.pending_erasure_cta', { count: erasure })}
            empty={t('direccion.empty')}
          />
        )}
      </div>
    </section>
  );
}

function TaskCard({
  icon,
  title,
  items,
  empty,
  fmt,
  hrefFor,
}: {
  icon: ReactNode;
  title: string;
  items: DireccionTaskItem[];
  empty: string;
  fmt: (iso: string) => string;
  hrefFor?: (e: DireccionTaskItem) => string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        {items.length > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-misterfc-green px-2 text-xs font-semibold text-zinc-900">
            {items.length}
          </span>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {items.length === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.slice(0, 5).map((e) => {
              const content = (
                <>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {(e.teamName ?? '—') + ' · ' + fmt(e.startsAt)}
                  </span>
                </>
              );
              return (
                <li key={e.eventId} className="py-2">
                  {hrefFor ? (
                    <Link
                      href={hrefFor(e)}
                      className="flex flex-col gap-0.5 rounded-md p-1 -mx-1 hover:bg-zinc-900/50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-0.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ManagementCard({
  icon,
  title,
  count,
  href,
  cta,
  empty,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  href: string;
  cta: string;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        {count > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-misterfc-green px-2 text-xs font-semibold text-zinc-900">
            {count}
          </span>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {count === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          <Link href={href} className="text-misterfc-green hover:underline">
            {cta}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
