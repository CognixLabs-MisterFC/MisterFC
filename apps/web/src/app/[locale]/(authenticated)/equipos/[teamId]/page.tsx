import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Settings, UserRound, Users } from 'lucide-react';
import { createSupabaseServerClient, formatPlayerName } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { InviteStaffDialog } from './invite-staff-dialog';
import { RemoveStaffButton } from './remove-staff-button';
import { CancelInvitationButton } from '../../invitations/cancel-invitation-button';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

const ROLES_THAT_CAN_MANAGE_STAFF: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
];

// Gate D13 (acceso a informes de desarrollo): staff del club, incl. ayudante.
const STAFF_ROLES: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const mDiff = now.getUTCMonth() - d.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export default async function TeamDetailPage({ params }: Props) {
  const { locale, teamId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: team } = await supabase
    .from('teams')
    .select(
      'id, name, format, color, season, category_id, categories!inner(id, name, club_id)'
    )
    .eq('id', teamId)
    .maybeSingle();

  if (!team) notFound();
  const category = team.categories as unknown as {
    id: string;
    name: string;
    club_id: string;
  };
  if (category.club_id !== ctx.activeClub.club.id) notFound();
  // Rework A (A3): la temporada vive en el equipo (teams.season).
  const season = team.season as string;

  const t = await getTranslations('equipo_detalle');
  const tStaff = await getTranslations('staff');
  const tCat = await getTranslations('jugadores');

  const canManageStaff = ROLES_THAT_CAN_MANAGE_STAFF.includes(
    ctx.activeClub.role
  );

  // Cuerpo técnico activo
  const { data: staffRows } = await supabase
    .from('team_staff')
    .select(
      'id, staff_role, joined_at, membership_id, memberships!inner(id, role, profiles!inner(full_name))'
    )
    .eq('team_id', teamId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });

  // Invitaciones pendientes del equipo (F2.6 hotfix 2026-05-30).
  // Pendiente = sin aceptar Y sin expirar. Las expiradas también se incluyen
  // para que el manager pueda limpiarlas (también caen bajo "pendientes" UX).
  const { data: pendingInviteRows } = await supabase
    .from('invitations')
    .select('id, email, team_staff_role, expires_at, created_at')
    .eq('team_id', teamId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  // Jugadores activos en el equipo (team_members con left_at null)
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'id, dorsal_in_team, position_in_team, joined_at, players!inner(id, first_name, last_name, date_of_birth, dorsal, position_main)'
    )
    .eq('team_id', teamId)
    .is('left_at', null);

  type StaffRow = {
    id: string;
    staff_role: string;
    joined_at: string;
    membership_id: string;
    memberships: {
      id: string;
      role: string;
      profiles: { full_name: string | null };
    };
  };
  type RosterRow = {
    id: string;
    dorsal_in_team: number | null;
    position_in_team: string | null;
    joined_at: string;
    players: {
      id: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
      dorsal: number | null;
      position_main: string | null;
    };
  };

  type PendingInvite = {
    id: string;
    email: string;
    team_staff_role: string | null;
    expires_at: string;
    created_at: string;
  };

  const staff = (staffRows ?? []) as unknown as StaffRow[];
  const roster = (rosterRows ?? []) as unknown as RosterRow[];
  // Server component: render una vez por request, sin re-renders. La regla
  // react-hooks/purity es over-protective aquí; el cálculo de "expirada" es
  // determinista para el snapshot del request.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const pendingInvites = (
    (pendingInviteRows ?? []) as unknown as PendingInvite[]
  ).map((inv) => ({
    ...inv,
    expired: new Date(inv.expires_at).getTime() < nowMs,
  }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/equipos">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
          <p className="text-sm text-muted-foreground">
            {category.name} · {season} · {team.format}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STAFF_ROLES.includes(ctx.activeClub.role) && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/equipos/${teamId}/informes`}>
                <span>{t('development_reports_link')}</span>
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/equipos/${teamId}/anuncios`}>
              <span>{t('announcements_link')}</span>
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" aria-hidden />
            {tStaff('title')}
          </CardTitle>
          {canManageStaff && (
            <InviteStaffDialog locale={locale} teamId={teamId} />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tStaff('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {staff.map((s) => {
                const name = s.memberships.profiles.full_name ?? '—';
                const isAssistant =
                  s.memberships.role === 'entrenador_ayudante';
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">
                        {tStaff(`role.${s.staff_role}`)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAssistant && canManageStaff && (
                        <Button asChild variant="ghost" size="icon" title={tStaff('caps')}>
                          <Link
                            href={`/equipos/${teamId}/staff/${s.membership_id}/capabilities`}
                          >
                            <Settings className="size-4" aria-hidden />
                          </Link>
                        </Button>
                      )}
                      {canManageStaff && (
                        <RemoveStaffButton
                          teamId={teamId}
                          teamStaffId={s.id}
                          staffName={name}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canManageStaff && pendingInvites.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {tStaff('pending_title')}
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {pendingInvites.map((inv) => {
                  return (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{inv.email}</span>
                        <span className="text-xs text-muted-foreground">
                          {inv.team_staff_role
                            ? tStaff(`role.${inv.team_staff_role}`)
                            : '—'}
                          {' · '}
                          {inv.expired
                            ? tStaff('pending_expired')
                            : tStaff('pending_status')}
                        </span>
                      </div>
                      <CancelInvitationButton
                        locale={locale}
                        invitationId={inv.id}
                        email={inv.email}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-5" aria-hidden />
            {t('roster_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('roster_empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {roster.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <Link
                    href={`/jugadores/${r.players.id}`}
                    className="flex flex-1 items-center gap-3 hover:opacity-90"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {formatPlayerName(r.players.first_name, r.players.last_name)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {tCat('age_years', {
                          age: ageFromDob(r.players.date_of_birth),
                        })}
                        {r.position_in_team
                          ? ` · ${tCat(`positions.${r.position_in_team}`)}`
                          : r.players.position_main
                            ? ` · ${tCat(`positions.${r.players.position_main}`)}`
                            : ''}
                      </span>
                    </div>
                  </Link>
                  {(r.dorsal_in_team ?? r.players.dorsal) != null && (
                    <Badge variant="secondary">
                      #{r.dorsal_in_team ?? r.players.dorsal}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
