import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, UserRound, Users } from 'lucide-react';
import {
  ADMIN_ROLES,
  STAFF_ROLES,
  TEAM_STAFF_ROLES,
  createSupabaseServerClient,
  formatPlayerName,
  getPlayersWithoutAppFromClient,
} from '@misterfc/core';
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
import { AddStaffDialog, type StaffCandidate } from './add-staff-dialog';
import { RemoveStaffButton } from './remove-staff-button';
import { NoAppBadge } from '@/components/no-app-badge';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

const ROLES_THAT_CAN_MANAGE_STAFF = ADMIN_ROLES;

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

  // BUG 3 · A-2 — candidatos a los que AÑADIR: los miembros del club que no son
  // jugadores. Antes, meter a alguien en un equipo pasaba siempre por invitarle
  // por correo, aunque ya estuviera dentro. No se excluye a quien ya es staff de
  // este equipo: el sistema admite dos funciones en el mismo equipo, y si se
  // repite la misma el action devuelve `role_exists`.
  let staffCandidates: StaffCandidate[] = [];
  if (canManageStaff) {
    type MemberRow = {
      id: string;
      role: string;
      profiles: { full_name: string | null };
    };
    const { data: memberRows } = await supabase
      .from('memberships')
      .select('id, role, profiles!inner(full_name)')
      .eq('club_id', category.club_id)
      .is('left_at', null);

    staffCandidates = (memberRows ?? [])
      .map((r) => r as unknown as MemberRow)
      .filter((r) => (STAFF_ROLES as readonly string[]).includes(r.role))
      .map((r) => ({
        membership_id: r.id,
        full_name: r.profiles.full_name ?? '—',
        club_role: r.role,
      }))
      .sort((a, b) =>
        a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' })
      );
  }

  // Funciones ofrecidas al añadir. El coordinador no nombra coordinadores: se lo
  // impide la RLS `team_staff_insert_admin`, así que tampoco se le ofrece.
  const assignableRoles =
    ctx.activeClub.role === 'coordinador'
      ? TEAM_STAFF_ROLES.filter((r) => r !== 'coordinador')
      : TEAM_STAFF_ROLES;

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

  const staff = (staffRows ?? []) as unknown as StaffRow[];
  const roster = (rosterRows ?? []) as unknown as RosterRow[];

  // Slice B — marcador "Sin app" en el roster. SOLO para el cuerpo técnico: es la
  // misma audiencia que la plantilla de /jugadores y la única con RLS para leer
  // `player_accounts`. Un tutor que llegue por URL a esta página no lo pide (leería
  // 0 filas y saldrían TODOS marcados, que es falso).
  const canSeeNoApp = STAFF_ROLES.includes(ctx.activeClub.role);
  const noAppIds = new Set(
    canSeeNoApp
      ? await getPlayersWithoutAppFromClient(
          supabase,
          roster.map((r) => r.players.id)
        )
      : []
  );

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
          {STAFF_ROLES.includes(ctx.activeClub.role) && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/equipos/${teamId}/jugadas`}>
                <span>{t('playbook_link')}</span>
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/equipos/${teamId}/anuncios`}>
              <span>{t('announcements_link')}</span>
            </Link>
          </Button>
          {/* F5B-3 — chat de grupo del equipo. La página gatea creación (staff/
              dirección) vs solo abrir (miembro); la RLS es la autoridad final. */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/mensajes/equipo/${teamId}`}>
              <span>{t('team_chat_link')}</span>
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
            <AddStaffDialog
              teamId={teamId}
              candidates={staffCandidates}
              assignableRoles={assignableRoles}
            />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tStaff('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {staff.map((s) => {
                const name = s.memberships.profiles.full_name ?? '—';
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
              {roster.map((r) => {
                const noApp = noAppIds.has(r.players.id);
                return (
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
                        {noApp && (
                          <NoAppBadge
                            label={tCat('no_app.label')}
                            hint={tCat('no_app.hint')}
                            showHint={false}
                          />
                        )}
                      </div>
                    </Link>
                    {(r.dorsal_in_team ?? r.players.dorsal) != null && (
                      <Badge variant="secondary">
                        #{r.dorsal_in_team ?? r.players.dorsal}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
