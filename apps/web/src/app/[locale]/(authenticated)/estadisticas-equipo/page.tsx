/**
 * F9.B-3 — Landing de "Estadísticas por equipo" (entrada de menú para staff).
 *
 * Resuelve los equipos del usuario en la temporada activa (§5, D11):
 *  - 1 equipo  → redirige directo a /equipos/[teamId]/estadisticas.
 *  - varios    → selector (lista de equipos).
 *  - 0         → estado vacío.
 *
 * Solo staff (admin/coord + entrenadores). Jugador/familia → /perfil.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BarChart3 } from 'lucide-react';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { loadStatsTeams } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
};

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function EstadisticasEquipoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}/perfil`);

  const teams = await loadStatsTeams(
    role,
    ctx.activeClub.membershipId,
    ctx.activeClub.club.id
  );

  // 1 equipo → directo a su detalle.
  if (teams.length === 1) {
    redirect(`/${locale}/equipos/${teams[0]!.id}/estadisticas`);
  }

  const t = await getTranslations('equipo_stats');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('pick_team')}</p>
        </div>
      </div>

      {teams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('no_teams')}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                href={`/equipos/${team.id}/estadisticas`}
                className="block rounded-xl transition hover:scale-[1.01]"
              >
                <Card
                  className="h-full border-l-4"
                  style={{ borderLeftColor: team.color }}
                >
                  <CardContent className="flex flex-col gap-0.5 py-4">
                    <span className="font-medium">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {team.category_name} · {team.season}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
