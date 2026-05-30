/**
 * /mis-equipos — Hub multi-equipo del entrenador.
 *
 * Lista TODOS los equipos donde el user es staff (principal o ayudante).
 * Click en card → /mis-equipos/[teamId].
 *
 * Permisos: solo entrenador_principal y entrenador_ayudante. Admin /
 * coordinador → redirect a /jugadores (su vista global). Jugador /
 * familia → redirect a /perfil.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Calendar, Megaphone, Users } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadCoachTeams } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
};

const STAFF_ROLES = ['entrenador_principal', 'entrenador_ayudante'] as const;

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

export default async function MisEquiposPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role;
  if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) {
    if (role === 'admin_club' || role === 'coordinador') {
      redirect(`/${locale}/jugadores`);
    }
    redirect(`/${locale}/perfil`);
  }

  const t = await getTranslations('mis_equipos');
  const teams = await loadCoachTeams(
    ctx.activeClub.membershipId,
    ctx.activeClub.club.id
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {teams.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('no_teams')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <li key={team.team_id}>
              <Link
                href={`/mis-equipos/${team.team_id}`}
                className="block rounded-xl transition hover:scale-[1.01]"
              >
                <Card className="h-full border-l-4" style={{ borderLeftColor: team.team_color }}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <CardTitle className="truncate">
                          {team.team_name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {team.category_name} · {team.category_season} ·{' '}
                          {team.team_format}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {t(`staff_role.${team.staff_role}`)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" aria-hidden />
                      <span>
                        {t('players_count', { count: team.players_count })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        {team.next_training_at == null
                          ? t('no_next_training')
                          : t('next_training', {
                              when: formatDateTime(
                                team.next_training_at,
                                locale
                              ),
                            })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Megaphone className="size-4 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        {team.next_match_at == null
                          ? t('no_next_match')
                          : t('next_match', {
                              when: formatDateTime(
                                team.next_match_at,
                                locale
                              ),
                              opponent:
                                team.next_match_opponent ?? t('opponent_tbd'),
                            })}
                      </span>
                    </div>
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
