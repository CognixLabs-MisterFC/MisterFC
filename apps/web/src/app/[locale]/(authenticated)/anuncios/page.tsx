import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Megaphone, Pin, Globe } from 'lucide-react';
import { createSupabaseServerClient, ADMIN_ROLES } from '@misterfc/core';
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
import { GlobalAnnouncementForm } from './global-announcement-form';
import { MarkNotificationsRead } from '@/components/notifications/mark-notifications-read';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    scope?: 'all' | 'club' | 'team';
    team_id?: string;
    since?: '7d' | '30d' | 'all';
  }>;
};

const PUBLISHER_ROLES = ADMIN_ROLES;
const SCOPE_VALUES: ReadonlyArray<string> = ['all', 'club', 'team'];
const SINCE_VALUES: ReadonlyArray<string> = ['7d', '30d', 'all'];

export default async function AnunciosGlobalesPage({
  params,
  searchParams,
}: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('anuncios_global');

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const role = ctx.activeClub.role;
  const canPublish = PUBLISHER_ROLES.includes(role);
  // C-2b: solo dirección emite anuncios de CLUB (team_id null). El coordinador emite
  // solo anuncios de EQUIPO de SUS equipos (la RLS C-1c ya lo impone). La RECEPCIÓN
  // de anuncios de club queda intacta (la lista no depende de esto).
  const canPublishClub = role === 'admin_club' || role === 'director';

  // Teams del club — para el form (admin/coord) y para el filtro de lista.
  // Bug-1: ambos son operativos → solo la temporada activa (sin duplicados del
  // rollover). El nombre de equipo de cada anuncio sale de su propio embed.
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, categories!inner(name, club_id)')
    .eq('categories.club_id', clubId)
    .eq('season', activeSeason)
    .order('name', { ascending: true });
  type TeamRow = {
    id: string;
    name: string;
    categories: { name: string; club_id: string };
  };
  const teams = (teamRows ?? []) as unknown as TeamRow[];

  // C-2b — Equipos ofrecidos en el FORMULARIO: el coordinador solo puede emitir para
  // SUS equipos; admin/director para todos. (La lista/filtros de abajo no cambian: la
  // recepción y el filtrado por RLS quedan intactos.)
  let formTeams = teams;
  if (canPublish && !canPublishClub) {
    const { data: myTeamIds } = await supabase.rpc('user_team_ids_in_club', {
      p_club_id: clubId,
    });
    const allowed = new Set(((myTeamIds ?? []) as unknown as string[]) ?? []);
    formTeams = teams.filter((tm) => allowed.has(tm.id));
  }

  // Filtros de URL (defaults: scope=all, since=30d).
  // BUG K — scope/team solo aplicables a admin/coord. Para entrenador y
  // jugador, RLS ya filtra a (club-wide + sus team_ids), así que el
  // selector de scope/team no aporta y lo ignoramos para evitar que un
  // URL manipulado se vea raro.
  const scope = canPublish && SCOPE_VALUES.includes(sp.scope ?? '')
    ? sp.scope!
    : 'all';
  const since = SINCE_VALUES.includes(sp.since ?? '') ? sp.since! : '30d';
  const filterTeamId = canPublish && scope === 'team' && sp.team_id
    ? sp.team_id
    : null;

  let q = supabase
    .from('announcements')
    .select(
      'id, title, body, pinned, expires_at, created_at, team_id, teams(name)',
    )
    .eq('club_id', clubId);

  if (canPublish && scope === 'club') q = q.is('team_id', null);
  if (canPublish && scope === 'team' && filterTeamId) {
    q = q.eq('team_id', filterTeamId);
  }

  if (since !== 'all') {
    const days = since === '7d' ? 7 : 30;
    // eslint-disable-next-line react-hooks/purity
    const horizonIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    q = q.gte('created_at', horizonIso);
  }

  const { data: annRows } = await q
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  type Ann = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    expires_at: string | null;
    created_at: string;
    team_id: string | null;
    teams: { name: string } | null;
  };
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const announcements = ((annRows ?? []) as unknown as Ann[]).map((a) => ({
    ...a,
    expired: a.expires_at !== null && new Date(a.expires_at).getTime() < nowMs,
  }));

  function urlFor(next: Partial<{ scope: string; team_id: string; since: string }>) {
    const params = new URLSearchParams();
    const s = next.scope ?? scope;
    const sn = next.since ?? since;
    if (s !== 'all') params.set('scope', s);
    if (s === 'team' && (next.team_id ?? filterTeamId)) {
      params.set('team_id', next.team_id ?? (filterTeamId as string));
    }
    if (sn !== '30d') params.set('since', sn);
    const qs = params.toString();
    return qs ? `/anuncios?${qs}` : '/anuncios';
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <MarkNotificationsRead types={['new_announcement']} />
      <div className="flex items-center gap-3">
        <Megaphone className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {canPublish ? t('subtitle') : t('subtitle_viewer')}
          </p>
        </div>
      </div>

      {canPublish && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <GlobalAnnouncementForm
              locale={locale}
              teams={formTeams.map((tm) => ({
                id: tm.id,
                name: `${tm.name} · ${tm.categories.name}`,
              }))}
              allowClubWide={canPublishClub}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Filtros — scope/team solo admin/coord (BUG K). since para todos. */}
          <div className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
            {canPublish && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">{t('filters.scope')}:</span>
                {(['all', 'club', 'team'] as const).map((s) => (
                  <Link
                    key={s}
                    href={urlFor({ scope: s })}
                    className={`rounded px-2 py-0.5 ${
                      scope === s
                        ? 'bg-misterfc-green text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {t(`filters.scope_${s}`)}
                  </Link>
                ))}
              </div>
            )}
            {canPublish && scope === 'team' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">{t('filters.team')}:</span>
                {teams.map((tm) => (
                  <Link
                    key={tm.id}
                    href={urlFor({ scope: 'team', team_id: tm.id })}
                    className={`rounded px-2 py-0.5 ${
                      filterTeamId === tm.id
                        ? 'bg-misterfc-green text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {tm.name}
                  </Link>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t('filters.since')}:</span>
              {(['7d', '30d', 'all'] as const).map((s) => (
                <Link
                  key={s}
                  href={urlFor({ since: s })}
                  className={`rounded px-2 py-0.5 ${
                    since === s
                      ? 'bg-misterfc-green text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {t(`filters.since_${s}`)}
                </Link>
              ))}
            </div>
          </div>

          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className={`rounded-md border p-3 ${
                    a.pinned
                      ? 'border-misterfc-green bg-emerald-950/20'
                      : 'border-zinc-800 bg-zinc-900/50'
                  } ${a.expired ? 'opacity-60' : ''}`}
                >
                  <Link
                    href={`/anuncios/${a.id}`}
                    className="flex flex-col gap-1 hover:opacity-90"
                  >
                    <div className="flex items-center gap-2">
                      {a.pinned && (
                        <Pin className="size-3 text-misterfc-green" aria-hidden />
                      )}
                      <h3 className="font-semibold">{a.title}</h3>
                      {a.team_id === null && (
                        <span className="flex items-center gap-1 rounded bg-misterfc-green/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-misterfc-green">
                          <Globe className="size-3" aria-hidden />
                          {t('badge.club_wide')}
                        </span>
                      )}
                      {a.expired && (
                        <span className="text-xs text-muted-foreground">
                          {t('list.expired')}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {a.body}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.team_id ? a.teams?.name ?? '—' : t('badge.club_wide')}
                      {' · '}
                      {new Date(a.created_at).toLocaleString(locale)}
                    </p>
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
