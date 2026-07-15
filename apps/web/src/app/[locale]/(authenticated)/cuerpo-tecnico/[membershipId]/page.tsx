import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  CalendarOff,
  Mail,
  Phone,
  Settings,
  Users,
} from 'lucide-react';
import { MANAGER_ROLES, TEAM_STAFF_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  computeRange,
  loadCalendarData,
  loadManageableTeams,
} from '../../calendario/queries';
import { CalendarAgenda } from '../../calendario/_components/calendar-agenda';
import { today as todayLocal } from '@/lib/calendar-utils';
import { MoveStaffDialog } from '../_components/move-staff-dialog';
import { AddAssignmentDialog } from '../_components/add-assignment-dialog';
import { RemoveAssignmentButton } from '../_components/remove-assignment-button';
import { EditStaffNameDialog } from '../_components/edit-staff-name-dialog';
import { EditStaffContactDialog } from '../_components/edit-staff-contact-dialog';
import { EditStaffRoleDialog } from '../_components/edit-staff-role-dialog';
import { loadCoachDetail } from '../queries';
import type { Role } from '../../jugadores/queries';

type Props = {
  params: Promise<{ locale: string; membershipId: string }>;
};

const ALLOWED_VIEW_ROLES = MANAGER_ROLES;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0).toUpperCase() ?? '';
  const last = parts[parts.length - 1]?.charAt(0).toUpperCase() ?? '';
  return `${first}${last !== first ? last : ''}`.slice(0, 2);
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export default async function CoachDetailPage({ params }: Props) {
  const { locale, membershipId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) {
    redirect(`/${locale}`);
  }

  const detail = await loadCoachDetail(
    ctx.activeClub.club.id,
    role,
    membershipId
  );
  if (!detail) notFound();

  const { coach, history, movableTargets, canManage, coordinatedTeamIds } =
    detail;

  // E-final-2 — Mover staff acotado para el coordinador:
  //  · destino: solo equipos que coordina (coordinatedTeamIds); admin/director todos.
  //  · rol: sin 'coordinador' (la RLS de team_staff lo rechaza); admin/director completo.
  //  · botón: se muestra por asignación solo si coordina el equipo ORIGEN (más abajo).
  const moveTargets = coordinatedTeamIds
    ? movableTargets.filter((tm) => coordinatedTeamIds.includes(tm.id))
    : movableTargets;
  const moveAssignableRoles =
    role === 'coordinador'
      ? TEAM_STAFF_ROLES.filter((r) => r !== 'coordinador')
      : TEAM_STAFF_ROLES;

  const t = await getTranslations('cuerpo_tecnico');
  const tStaff = await getTranslations('staff.role');
  const tClubRole = await getTranslations('roles');
  const tCal = await getTranslations('calendario');

  // Agenda F3: próximos 30 días (vista agenda = 28 días) filtrada a los
  // teams activos del coach.
  const today = todayLocal();
  const range = computeRange('agenda', today);
  const activeTeamIds = coach.assignments.map((a) => a.team_id);
  const calendarData = activeTeamIds.length > 0
    ? await loadCalendarData(ctx.activeClub.club.id, range, {
        teamIds: activeTeamIds,
        categoryIds: [],
        types: [],
      })
    : { events: [], teams: [], categories: [] };

  // Para componer la pill de eventos necesitamos saber qué teams puede
  // gestionar el user actual.
  const { manageableTeamIds, canManageClubEvents } = await loadManageableTeams(
    ctx.activeClub.club.id,
    role,
    calendarData.teams
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cuerpo-tecnico">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('detail.back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <span
          className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground"
          aria-hidden
        >
          {initials(coach.full_name)}
        </span>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {coach.full_name}
            </h1>
            {/* Bug 2 · 2a: solo admin_club, y no para uno mismo (eso va en /perfil). */}
            {role === 'admin_club' && coach.profile_id !== ctx.user.id && (
              <EditStaffNameDialog
                targetProfileId={coach.profile_id}
                currentName={coach.full_name}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {tClubRole(coach.club_role)}
              {coach.club_role === 'entrenador_ayudante' &&
                coach.caps_granted != null && (
                  <>
                    {' '}
                    ·{' '}
                    {t('caps_summary', {
                      granted: coach.caps_granted,
                      total: 9,
                    })}
                  </>
                )}
            </p>
            {/* Bug 2 · 2b + F1B-3c: gestionan roles bajos admin_club y director.
                El diálogo solo ofrece roles bajos como destino (STAFF_CLUB_ROLES);
                los altos van por invitación (F1B-2b). El target de esta página
                siempre es un coach (loadCoachDetail filtra a COACH_ROLES: principal/
                ayudante) → nunca un rol alto, así que no hay nada que ocultar por
                owner aquí; el caso alto lo cubre el gate server (forbidden_requires_
                owner). La guarda del último admin la impone la función SQL. */}
            {(role === 'admin_club' || role === 'director') && (
              <EditStaffRoleDialog
                targetProfileId={coach.profile_id}
                currentRole={coach.club_role}
                isSelf={coach.profile_id === ctx.user.id}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bug 2 · 2c: contacto gestionado por el club (solo staff, no público).
          NO es el email de login. La edición se gatea a admin_club y no a uno mismo. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>{t('contact.title')}</CardTitle>
          {role === 'admin_club' && coach.profile_id !== ctx.user.id && (
            <EditStaffContactDialog
              targetProfileId={coach.profile_id}
              currentPhone={coach.phone}
              currentContactEmail={coach.contact_email}
            />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {coach.phone == null && coach.contact_email == null ? (
            <p className="text-sm text-muted-foreground">
              {t('contact.empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              {coach.phone != null && (
                <div className="flex items-center gap-2">
                  <Phone
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <a href={`tel:${coach.phone}`} className="hover:underline">
                    {coach.phone}
                  </a>
                </div>
              )}
              {coach.contact_email != null && (
                <div className="flex items-center gap-2">
                  <Mail
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <a
                    href={`mailto:${coach.contact_email}`}
                    className="hover:underline"
                  >
                    {coach.contact_email}
                  </a>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" aria-hidden />
            {t('detail.teams_title')}
          </CardTitle>
          {/* Serie C — Agregar rol/equipo. admin/director asignan cualquier rol en
              cualquier equipo; el coordinador (C-2c) solo en SUS equipos
              (movableTargets ya acotado) y sin la opción 'coordinador'. */}
          {(role === 'admin_club' ||
            role === 'director' ||
            role === 'coordinador') && (
            <AddAssignmentDialog
              membershipId={coach.membership_id}
              teams={movableTargets.map((tm) => ({
                id: tm.id,
                name: tm.name,
                category_name: tm.category_name,
              }))}
              assignableRoles={
                role === 'coordinador'
                  ? TEAM_STAFF_ROLES.filter((r) => r !== 'coordinador')
                  : TEAM_STAFF_ROLES
              }
            />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {coach.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('detail.no_active_teams')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {coach.assignments.map((a) => (
                <li
                  key={a.team_staff_id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <Link
                    href={`/equipos/${a.team_id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90"
                  >
                    <span
                      className="size-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: a.team_color }}
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {a.team_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.category_name} · {a.category_season} ·{' '}
                        {tStaff(a.staff_role)}
                      </span>
                    </div>
                  </Link>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      {/* Follow-up: el enlace de capabilities lleva a /equipos/[teamId]
                          (estructura, cerrada al coordinador por C-2b) → se oculta al
                          coordinador (coordinatedTeamIds != null). admin/director lo ven. */}
                      {coach.club_role === 'entrenador_ayudante' &&
                        coordinatedTeamIds === null && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            title={t('detail.edit_caps')}
                          >
                            <Link
                              href={`/equipos/${a.team_id}/staff/${coach.membership_id}/capabilities`}
                            >
                              <Settings className="size-4" aria-hidden />
                            </Link>
                          </Button>
                        )}
                      {/* E-final-2: el coordinador solo mueve DESDE equipos que
                          coordina (coordinatedTeamIds); admin/director, todos. */}
                      {(coordinatedTeamIds === null ||
                        coordinatedTeamIds.includes(a.team_id)) && (
                        <MoveStaffDialog
                          compact
                          membershipId={coach.membership_id}
                          teamStaffId={a.team_staff_id}
                          currentTeamId={a.team_id}
                          currentStaffRole={a.staff_role}
                          assignableRoles={moveAssignableRoles}
                          targets={moveTargets.map((tm) => ({
                            id: tm.id,
                            name: tm.name,
                            category_name: tm.category_name,
                          }))}
                        />
                      )}
                      {/* Follow-up: el coordinador solo quita asignaciones de equipos
                          que coordina (RLS team_staff_delete lo exige); admin/director,
                          todas. Mismo patrón que el botón mover (#353). */}
                      {(coordinatedTeamIds === null ||
                        coordinatedTeamIds.includes(a.team_id)) && (
                        <RemoveAssignmentButton
                          compact
                          teamStaffId={a.team_staff_id}
                          membershipId={coach.membership_id}
                          teamName={a.team_name}
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.agenda_title')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('detail.agenda_subtitle')}
          </p>
        </CardHeader>
        <CardContent>
          {activeTeamIds.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CalendarOff
                className="size-8 text-muted-foreground"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                {t('detail.agenda_no_teams')}
              </p>
            </div>
          ) : calendarData.events.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CalendarOff
                className="size-8 text-muted-foreground"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                {tCal('agenda.empty')}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/calendario?view=agenda&${activeTeamIds
                    .map((id) => `team=${encodeURIComponent(id)}`)
                    .join('&')}`}
                >
                  {t('detail.agenda_open')}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <CalendarAgenda
                events={calendarData.events}
                locale={locale}
                manageableTeamIds={manageableTeamIds}
                canManageClubEvents={canManageClubEvents}
                teams={calendarData.teams}
                categories={calendarData.categories}
                role={role}
                canCreateSessions={false}
              />
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/calendario?view=month&${activeTeamIds
                      .map((id) => `team=${encodeURIComponent(id)}`)
                      .join('&')}`}
                  >
                    {t('detail.agenda_open_month')}
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.history_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('detail.history_empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {history.map((h) => (
                <li
                  key={h.team_staff_id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {h.team_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {h.category_name} · {h.category_season} ·{' '}
                      {tStaff(h.staff_role)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(h.joined_at, locale)}</span>
                    <span>→</span>
                    {h.left_at ? (
                      <span>{formatDate(h.left_at, locale)}</span>
                    ) : (
                      <Badge variant="secondary">
                        {t('detail.history_active')}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
