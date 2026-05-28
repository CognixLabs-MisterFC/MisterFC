import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { UserRound } from 'lucide-react';
import { createSupabaseServerClient, PLAYER_POSITIONS } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TeamSelector } from './team-selector';
import { PositionFilter } from './position-filter';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ team?: string; position?: string }>;
};

const STAFF_ROLES: ReadonlyArray<string> = [
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

export default async function MiPlantillaPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { team: teamParam, position: positionParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  // Solo entrenadores tienen "Mi plantilla". admin/coord usan /jugadores.
  if (!STAFF_ROLES.includes(ctx.activeClub.role)) {
    redirect(`/${locale}/jugadores`);
  }

  const t = await getTranslations('mi_plantilla');
  const tCat = await getTranslations('jugadores');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Lista de teams en los que el user es staff activo del club activo.
  // El user ve sus propias filas team_staff via RLS (clubmate).
  const { data: myStaffRows } = await supabase
    .from('team_staff')
    .select(
      'team_id, staff_role, teams!inner(id, name, categories!inner(club_id, name, season))'
    )
    .eq('membership_id', ctx.activeClub.membershipId)
    .is('left_at', null);

  type StaffTeam = {
    team_id: string;
    staff_role: string;
    teams: {
      id: string;
      name: string;
      categories: { club_id: string; name: string; season: string };
    };
  };
  const myStaff = ((myStaffRows ?? []) as unknown as StaffTeam[]).filter(
    (s) => s.teams.categories.club_id === ctx.activeClub.club.id
  );

  // Resolver team activo: query param > primer team del user.
  let activeTeamId: string | null = null;
  if (teamParam && myStaff.some((s) => s.team_id === teamParam)) {
    activeTeamId = teamParam;
  } else if (myStaff.length > 0) {
    activeTeamId = myStaff[0]!.team_id;
  }

  if (!activeTeamId) {
    // Sin equipos asignados — mensaje informativo.
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <UserRound
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">{t('no_teams')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Roster del team activo + filter por posición.
  const positionFilter = PLAYER_POSITIONS.includes(
    positionParam as (typeof PLAYER_POSITIONS)[number]
  )
    ? (positionParam as (typeof PLAYER_POSITIONS)[number])
    : null;

  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'id, dorsal_in_team, position_in_team, joined_at, players!inner(id, first_name, last_name, date_of_birth, dorsal, position_main)'
    )
    .eq('team_id', activeTeamId)
    .is('left_at', null);

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

  const roster = (rosterRows ?? []) as unknown as RosterRow[];
  const filteredRoster = positionFilter
    ? roster.filter(
        (r) =>
          (r.position_in_team ?? r.players.position_main) === positionFilter
      )
    : roster;

  // Ordenar alfabéticamente por apellido.
  filteredRoster.sort((a, b) =>
    a.players.last_name.localeCompare(b.players.last_name)
  );

  const activeTeam = myStaff.find((s) => s.team_id === activeTeamId)!;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeTeam.teams.name} · {activeTeam.teams.categories.name} ·{' '}
            {activeTeam.teams.categories.season}
          </p>
        </div>
        {myStaff.length > 1 && (
          <TeamSelector
            currentTeamId={activeTeamId}
            teams={myStaff.map((s) => ({
              id: s.team_id,
              name: s.teams.name,
            }))}
          />
        )}
      </div>

      <PositionFilter currentPosition={positionFilter} />

      <Card>
        <CardHeader>
          <CardTitle>
            {t('count', { count: filteredRoster.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-0">
          {filteredRoster.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {filteredRoster.map((r) => {
                const position = r.position_in_team ?? r.players.position_main;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/jugadores/${r.players.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {r.players.last_name}, {r.players.first_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tCat('age_years', {
                            age: ageFromDob(r.players.date_of_birth),
                          })}
                          {position
                            ? ` · ${tCat(`positions.${position}`)}`
                            : ''}
                        </span>
                      </div>
                      {(r.dorsal_in_team ?? r.players.dorsal) != null && (
                        <Badge variant="secondary">
                          #{r.dorsal_in_team ?? r.players.dorsal}
                        </Badge>
                      )}
                    </Link>
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
