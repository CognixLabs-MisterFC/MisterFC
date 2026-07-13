/**
 * F14E-4 — "Planificación de entrenamientos" (jugador): índice de las sesiones
 * COMPARTIDAS (visibility='team') de los equipos del jugador, próximas (incluido
 * hoy), en solo lectura. Enlaza al detalle read-only existente
 * (`/mi-equipo/sesiones/[id]`). El flag de compartido es el único control: la RLS
 * de 12.1 (user_is_team_member_account + visibility='team') es el gate real; aquí
 * solo se scopea a los equipos del jugador.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardList, Clock } from 'lucide-react';
import {
  createSupabaseServerClient,
  teamsInActiveSeason,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { loadSharedSessionsForTeams } from '../../sesiones/queries';

type Props = { params: Promise<{ locale: string }> };

export default async function PlanificacionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('planificacion');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Players vinculados al user en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id)')
    .eq('profile_id', ctx.user.id);
  type PA = { player_id: string; players: { id: string; club_id: string } };
  const myPlayerIds = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === ctx.activeClub.club.id)
    .map((p) => p.player_id);

  // Teams del jugador (temporada activa).
  type TM = {
    team_id: string;
    teams: { id: string; name: string; season: string; category_id: string };
  };
  let teams: Array<{ id: string; name: string }> = [];
  if (myPlayerIds.length > 0) {
    const { data: tmRows } = await supabase
      .from('team_members')
      .select('team_id, teams!inner(id, name, season, category_id)')
      .in('player_id', myPlayerIds)
      .is('left_at', null);
    const activeSeason = await getActiveSeasonLabel(
      supabase,
      ctx.activeClub.club.id,
    );
    teams = teamsInActiveSeason(
      ((tmRows ?? []) as unknown as TM[]).map((r) => ({
        ...r,
        season: r.teams.season,
      })),
      activeSeason,
    ).map((r) => ({ id: r.teams.id, name: r.teams.name }));
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const sessions = await loadSharedSessionsForTeams(
    ctx.activeClub.club.id,
    teams,
    todayIso,
  );
  const showTeam = teams.length > 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`/mi-equipo/sesiones/${s.id}`}
                    className="flex flex-col gap-0.5 rounded-md p-1 -mx-1 hover:bg-zinc-900/50"
                  >
                    <span className="font-medium">
                      {s.title ?? t('untitled')}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {new Date(
                          `${s.session_date}T00:00:00`,
                        ).toLocaleDateString(locale)}
                      </span>
                      {s.total_minutes != null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {t('minutes', { count: s.total_minutes })}
                        </span>
                      )}
                      {showTeam && s.team_name && (
                        <Badge variant="outline" className="text-xs">
                          {s.team_name}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
