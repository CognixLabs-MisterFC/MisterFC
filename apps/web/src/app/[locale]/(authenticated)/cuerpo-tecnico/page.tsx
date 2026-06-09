import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Users } from 'lucide-react';
import { TEAM_STAFF_ROLES, type TeamStaffRole } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StaffSearchInput } from './_components/staff-search-input';
import { StaffFilters } from './_components/staff-filters';
import { MoveStaffDialog } from './_components/move-staff-dialog';
import { loadCoachList } from './queries';
import type { Role } from '../jugadores/queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    role?: string | string[];
    team?: string | string[];
    category?: string | string[];
  }>;
};

const ALLOWED_VIEW_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

function normalizeMulti(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((s) => s.length > 0);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0).toUpperCase() ?? '';
  const last = parts[parts.length - 1]?.charAt(0).toUpperCase() ?? '';
  return `${first}${last !== first ? last : ''}`.slice(0, 2);
}

export default async function CuerpoTecnicoPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('cuerpo_tecnico');
  const tStaff = await getTranslations('staff.role');
  const tClubRole = await getTranslations('roles');

  const search = (sp.q ?? '').trim();
  const staffRolesRaw = normalizeMulti(sp.role);
  const staffRoles = staffRolesRaw.filter((r) =>
    (TEAM_STAFF_ROLES as readonly string[]).includes(r)
  ) as TeamStaffRole[];
  const teamIds = normalizeMulti(sp.team);
  const categoryIds = normalizeMulti(sp.category);

  const result = await loadCoachList(ctx.activeClub.club.id, role, {
    search,
    staffRoles,
    teamIds,
    categoryIds,
  });

  const hasFilters =
    search.length > 0 ||
    staffRoles.length > 0 ||
    teamIds.length > 0 ||
    categoryIds.length > 0;

  const targetsForMove = result.visibleTeams.map((t) => ({
    id: t.id,
    name: t.name,
    category_name: t.category_name,
  }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('count', { count: result.total })}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <StaffSearchInput />
        <StaffFilters
          teams={result.visibleTeams.map((tm) => ({
            id: tm.id,
            name: tm.name,
            category_name: tm.category_name,
          }))}
          categories={result.visibleCategories.map((c) => ({
            id: c.id,
            name: c.name,
          }))}
          activeStaffRoles={staffRoles}
          activeTeamIds={teamIds}
          activeCategoryIds={categoryIds}
        />
      </div>

      {result.coaches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              {hasFilters ? t('empty_filtered') : t('empty')}
            </p>
            {hasFilters && (
              <Button asChild variant="outline" size="sm">
                <Link href="/cuerpo-tecnico">{t('filters.clear')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" aria-label={t('table.avatar')} />
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('table.club_role')}
                  </TableHead>
                  <TableHead>{t('table.teams')}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('table.caps')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('table.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.coaches.map((c) => (
                  <TableRow key={c.membership_id}>
                    <TableCell>
                      <span
                        className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        aria-hidden
                      >
                        {initials(c.full_name)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/cuerpo-tecnico/${c.membership_id}`}
                        className="flex flex-col hover:underline"
                      >
                        <span className="font-medium">{c.full_name}</span>
                        <span className="text-xs text-muted-foreground md:hidden">
                          {tClubRole(c.club_role)}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {tClubRole(c.club_role)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ul className="flex flex-wrap gap-1">
                        {c.assignments.map((a) => (
                          <li key={a.team_staff_id}>
                            <Link
                              href={`/equipos/${a.team_id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-card/30 px-2 py-0.5 text-xs hover:bg-card/60"
                              style={{
                                borderLeftWidth: 3,
                                borderLeftColor: a.team_color,
                              }}
                              title={`${a.category_name} · ${tStaff(a.staff_role)}`}
                            >
                              <span className="font-medium">{a.team_name}</span>
                              <span className="text-muted-foreground">
                                · {tStaff(a.staff_role)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {c.club_role === 'entrenador_ayudante' &&
                      c.caps_granted != null ? (
                        <span className="text-xs text-muted-foreground">
                          {t('caps_summary', {
                            granted: c.caps_granted,
                            total: 9,
                          })}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {result.canManage && c.assignments[0] && (
                          <MoveStaffDialog
                            compact
                            membershipId={c.membership_id}
                            teamStaffId={c.assignments[0].team_staff_id}
                            currentTeamId={c.assignments[0].team_id}
                            currentStaffRole={c.assignments[0].staff_role}
                            targets={targetsForMove}
                          />
                        )}
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/cuerpo-tecnico/${c.membership_id}`}>
                            {t('row_actions.open')}
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
