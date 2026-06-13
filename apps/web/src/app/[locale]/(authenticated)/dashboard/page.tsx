/**
 * F10.1 — Dashboard ejecutivo del club (ruta nueva `/dashboard`).
 *
 * Gating en SERVIDOR a admin_club + coordinador (no basta con ocultar la entrada
 * en la nav): cualquier otro rol que navegue a la URL se redirige. El shell deja
 * las áreas de las secciones que llegan en 10.3–10.6 (resultados, asistencia,
 * alertas, rankings) con placeholder para no dejarlas huérfanas.
 *
 * En 10.1 está VIVA la sección de censo (total + distribución por categoría y por
 * equipo), que prueba el pipe loader→core→UI de punta a punta. La comparativa con
 * la temporada anterior y los enlaces a /jugadores y /cuerpo-tecnico se completan
 * en 10.2 (el label de la temporada anterior ya viene resuelto del loader).
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LayoutDashboard, Users, Trophy, ClipboardCheck, TriangleAlert, Medal } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadClubDashboardBase } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
};

/** Solo dirección ve el dashboard ejecutivo (spec 10.0 §5.0, D6). */
const DASHBOARD_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  // Gating en servidor: redirige a la home si no es dirección.
  if (!DASHBOARD_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('dashboard');
  const { season, census } = await loadClubDashboardBase(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle', {
              club: ctx.activeClub.club.name,
              season: season.activeSeason,
            })}
          </p>
        </div>
      </div>

      {/* ── Sección CENSO (10.1, viva) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" aria-hidden />
            {t('census.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <p className="text-4xl font-bold tabular-nums">{census.totalPlayers}</p>
            <p className="text-sm text-muted-foreground">{t('census.total_players')}</p>
          </div>

          {census.byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('census.empty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Distribución por categoría */}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('census.by_category')}</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('census.col.category')}</TableHead>
                      <TableHead className="text-right">{t('census.col.teams')}</TableHead>
                      <TableHead className="text-right">{t('census.col.players')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {census.byCategory.map((c) => (
                      <TableRow key={c.categoryId}>
                        <TableCell className="font-medium">{c.categoryName}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.teamCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.playerCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Distribución por equipo */}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('census.by_team')}</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('census.col.team')}</TableHead>
                      <TableHead>{t('census.col.category')}</TableHead>
                      <TableHead className="text-right">{t('census.col.players')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {census.byTeam.map((tm) => (
                      <TableRow key={tm.teamId}>
                        <TableCell className="font-medium">{tm.teamName}</TableCell>
                        <TableCell className="text-muted-foreground">{tm.categoryName}</TableCell>
                        <TableCell className="text-right tabular-nums">{tm.playerCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('census.next_phase_note')}</p>
        </CardContent>
      </Card>

      {/* ── Placeholders de las secciones que llegan en 10.3–10.6 ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlaceholderCard
          icon={<Trophy className="size-4" aria-hidden />}
          title={t('results.title')}
          soon={t('coming_soon')}
        />
        <PlaceholderCard
          icon={<ClipboardCheck className="size-4" aria-hidden />}
          title={t('attendance.title')}
          soon={t('coming_soon')}
        />
        <PlaceholderCard
          icon={<TriangleAlert className="size-4" aria-hidden />}
          title={t('alerts.title')}
          soon={t('coming_soon')}
        />
        <PlaceholderCard
          icon={<Medal className="size-4" aria-hidden />}
          title={t('rankings.title')}
          soon={t('coming_soon')}
        />
      </div>
    </div>
  );
}

function PlaceholderCard({
  icon,
  title,
  soon,
}: {
  icon: React.ReactNode;
  title: string;
  soon: string;
}) {
  return (
    <Card className="border-dashed opacity-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{soon}</CardContent>
    </Card>
  );
}
