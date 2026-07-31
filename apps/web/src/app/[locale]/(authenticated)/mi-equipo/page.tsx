import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  Calendar,
  Megaphone,
  ClipboardList,
  Shield,
  Swords,
  Users,
} from 'lucide-react';
import {
  createSupabaseServerClient,
  getPlayerTeamsFromClient,
  getTeamHomeFromClient,
  isMatchSurfaceType,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SharedLineupSection } from '@/components/match/shared-lineup-section';
import { loadTeamPlaybook } from '../jugadas/queries';
import { TeamSelectorWrapper } from './team-selector-wrapper';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ team?: string }>;
};

// F14E-5 — Detalle del evento según su tipo (mapeo EXPLÍCITO, no isMatchSurfaceType):
// partidos/amistosos/torneos → convocatoria; entrenamiento → asistencia; `other`
// no tiene pantalla de detalle → sin enlace (item visible, no clicable).
function eventDetailHref(type: string, id: string): string | null {
  if (type === 'match' || type === 'friendly' || type === 'tournament') {
    return `/convocatorias/${id}`;
  }
  if (type === 'training') return `/asistencia/${id}`;
  return null;
}

export default async function MiEquipoPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('mi_equipo');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // 1) Players vinculados al user (vía player_accounts) en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id)')
    .eq('profile_id', ctx.user.id);
  type PA = {
    player_id: string;
    players: { id: string; club_id: string };
  };
  const myPlayerIds = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === ctx.activeClub.club.id)
    .map((p) => p.player_id);

  if (myPlayerIds.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Shield className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team')}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2) Teams del jugador — O2-5 D1: el FETCH (equipos de unos jugadores en la
  //    temporada activa) se extrajo a core. La web AGREGA todos los hijos
  //    (`myPlayerIds`); la app nativa pasa solo el hijo activo (divergencia
  //    deliberada). Bug-1: `getPlayerTeamsFromClient` ya filtra a la temporada activa.
  const activeSeason = await getActiveSeasonLabel(
    supabase,
    ctx.activeClub.club.id,
  );
  const myTeams = await getPlayerTeamsFromClient(
    supabase,
    ctx.activeClub.club.id,
    myPlayerIds,
    activeSeason,
  );

  if (myTeams.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Shield className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_team')}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 3) Resolver team activo a renderizar — query param o el primero.
  const requestedTeamId = sp.team;
  const activeTeam =
    myTeams.find((t) => t.team_id === requestedTeamId) ?? myTeams[0]!;
  const activePlayerId = activeTeam.player_id;
  const allTeamIds = myTeams.map((t) => t.team_id);

  // 4-6) Home del equipo (compañeros + próximos eventos + anuncios) — FETCH en core.
  // eslint-disable-next-line react-hooks/purity
  const nowIso = new Date().toISOString();
  const { teammates, upcoming, announcements } = await getTeamHomeFromClient(
    supabase,
    ctx.activeClub.club.id,
    activeTeam.team_id,
    activePlayerId,
    allTeamIds,
    nowIso,
  );

  // F13.6 — Playbook: recuento para la card resumen (el listado/visor es D2). La
  // RLS de 13.1b es el gate; aquí solo se piden las del team.
  const playbook = await loadTeamPlaybook(ctx.activeClub.club.id, activeTeam.team_id);

  // F6 Lote B — alineación oficial compartida del próximo partido (si la hay
  // y es visibility=team; la sección se auto-oculta vía RLS si no).
  const nextMatchId =
    upcoming.find((e) => isMatchSurfaceType(e.type))?.id ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Shield className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {myTeams.length === 1 ? t('subtitle_one') : t('subtitle_many')}
        </p>
      </div>

      {myTeams.length > 1 && (
        <TeamSelectorWrapper
          locale={locale}
          activeTeamId={activeTeam.team_id}
          teams={myTeams.map((m) => ({
            id: m.team_id,
            name: m.name,
            category_name: m.category_name,
          }))}
        />
      )}

      {nextMatchId && <SharedLineupSection eventId={nextMatchId} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: activeTeam.color }}
              aria-hidden
            />
            {activeTeam.name}
          </CardTitle>
          <CardDescription>
            {t('category_format', {
              category: activeTeam.category_name,
              season: activeTeam.season,
              minutes: activeTeam.half_duration_minutes,
            })}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" aria-hidden />
              {t('cards.teammates.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {teammates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('cards.teammates.empty')}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-3">
                {teammates.slice(0, 12).map((tm) => (
                  <li
                    key={tm.id}
                    className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-sm"
                  >
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
                      {tm.dorsal ?? '—'}
                    </span>
                    <span>{tm.full_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className="flex items-center justify-between pt-0">
            <Link
              href={`/mi-equipo/plantilla?team=${activeTeam.team_id}`}
              className="text-xs text-misterfc-green hover:underline"
            >
              {t('cards.teammates.view_all')}
            </Link>
            {teammates.length > 12 && (
              <span className="text-xs text-muted-foreground">
                +{teammates.length - 12}
              </span>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="size-4" aria-hidden />
              {t('cards.upcoming.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">
                {t('cards.upcoming.empty')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {upcoming.map((e) => {
                  const href = eventDetailHref(e.type, e.id);
                  const inner = (
                    <>
                      <span className="font-medium">{e.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.starts_at).toLocaleString(locale)}
                        {e.opponent_name && ` · vs ${e.opponent_name}`}
                        {e.location_name && ` · ${e.location_name}`}
                      </span>
                    </>
                  );
                  return (
                    <li key={e.id} className="first:pt-0 last:pb-0">
                      {href ? (
                        <Link
                          href={href}
                          className="flex flex-col gap-0.5 rounded-md p-1 -mx-1 py-2 hover:bg-zinc-900/50"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex flex-col gap-0.5 py-2">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* F13.6/JR — Card RESUMEN: recuento + teaser; el listado vive en la
            página /mi-equipo/jugadas. Si no hay jugadas compartidas, no se pinta. */}
        {playbook.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Swords className="size-4" aria-hidden />
                {t('cards.playbook.title')}
              </CardTitle>
              <CardDescription>
                {t('cards.playbook.count', { count: playbook.length })}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <ul className="flex flex-col gap-0.5">
                {playbook.slice(0, 2).map((p) => (
                  <li key={p.id} className="truncate text-muted-foreground">
                    {p.name ?? t('cards.playbook.untitled')}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Link
                href={`/mi-equipo/jugadas?team=${activeTeam.team_id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('cards.playbook.view_all')}
              </Link>
            </CardFooter>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4" aria-hidden />
              {t('cards.announcements.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {announcements.length === 0 ? (
              <p className="text-muted-foreground">
                {t('cards.announcements.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {announcements.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/anuncios/${a.id}`}
                      className="flex flex-col gap-0.5 rounded-md p-1 -mx-1 hover:bg-zinc-900/50"
                    >
                      <span className="font-medium">{a.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.team_id === null
                          ? t('cards.announcements.club_wide')
                          : activeTeam.name}
                        {' · '}
                        {new Date(a.created_at).toLocaleDateString(locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className="pt-0">
            <Link
              href="/anuncios"
              className="text-xs text-misterfc-green hover:underline"
            >
              {t('cards.announcements.view_all')}
            </Link>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4" aria-hidden />
              {t('cards.callups.title')}
            </CardTitle>
            <CardDescription>{t('cards.callups.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/convocatorias"
              className="text-sm text-misterfc-green hover:underline"
            >
              {t('cards.callups.cta')}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
