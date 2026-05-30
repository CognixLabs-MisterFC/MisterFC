import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Calendar, ClipboardCheck, Megaphone, MessageSquare } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  params: Promise<{ locale: string }>;
};

const COACH_ROLES = new Set<string>([
  'entrenador_principal',
  'entrenador_ayudante',
]);
const ADMIN_LIKE_ROLES = new Set<string>(['admin_club', 'coordinador']);

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) {
    // El layout debería haber redirigido. Renderizar placeholder mínimo.
    return null;
  }

  const t = await getTranslations('home');
  const tRoles = await getTranslations('roles');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const role = ctx.activeClub.role;
  const isPlayer = role === 'jugador';
  const isCoach = COACH_ROLES.has(role);
  const isAdminLike = ADMIN_LIKE_ROLES.has(role);
  const clubId = ctx.activeClub.club.id;

  // ─── Datos para Cards ───
  const nowIso = new Date().toISOString();

  // Mensajes no leídos — todos los roles.
  const { data: unreadRows } = await supabase
    .from('messages')
    .select('conversation_id')
    .is('read_at', null)
    .neq('sender_profile_id', ctx.user.id);
  const unreadConversations = new Set(
    (unreadRows ?? []).map((m) => m.conversation_id),
  ).size;

  // Anuncios recientes que el user ve (RLS filtra).
  const { data: annRows } = await supabase
    .from('announcements')
    .select('id, title, body, pinned, team_id, club_id, created_at, teams(name)')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
    .limit(5);
  type AnnRow = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    team_id: string | null;
    club_id: string;
    created_at: string;
    teams: { name: string } | null;
  };
  const announcements = (annRows ?? []) as unknown as AnnRow[];

  // Próximos eventos (24-72h) — relevante para jugador y coach.
  // Server component: render una vez por request, Date.now() determinista
  // para el snapshot. La regla react-hooks/purity es over-protective aquí.
  // eslint-disable-next-line react-hooks/purity
  const upcomingHorizon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: upcomingEventRows } = isPlayer || isCoach
    ? await supabase
        .from('events')
        .select('id, title, type, starts_at, team_id, teams(name)')
        .gte('starts_at', nowIso)
        .lte('starts_at', upcomingHorizon)
        .order('starts_at', { ascending: true })
        .limit(5)
    : { data: [] };
  type Ev = {
    id: string;
    title: string;
    type: string;
    starts_at: string;
    team_id: string | null;
    teams: { name: string } | null;
  };
  const upcomingEvents = (upcomingEventRows ?? []) as unknown as Ev[];

  // Convocatorias pendientes a publicar (coach).
  let pendingCallupsCount = 0;
  if (isCoach) {
    const { count } = await supabase
      .from('events')
      .select('id, match_callup_meta!left(event_id, published_at)', {
        count: 'exact',
        head: true,
      })
      .eq('type', 'match')
      .gte('starts_at', nowIso)
      .lte('starts_at', upcomingHorizon)
      .is('match_callup_meta.published_at', null);
    pendingCallupsCount = count ?? 0;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t('welcome', { club: ctx.activeClub.club.name })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('your_role', { role: tRoles(role) })}
        </p>
      </div>

      {/* Grid de cards rol-aware */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Mensajes no leídos — para todos los roles */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4" aria-hidden />
              {t('cards.messages.title')}
            </CardTitle>
            {unreadConversations > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-misterfc-green px-2 text-xs font-semibold text-zinc-900">
                {unreadConversations}
              </span>
            )}
          </CardHeader>
          <CardContent className="text-sm">
            {unreadConversations > 0 ? (
              <Link href="/mensajes" className="text-misterfc-green hover:underline">
                {t('cards.messages.cta', { count: unreadConversations })}
              </Link>
            ) : (
              <p className="text-muted-foreground">{t('cards.messages.empty')}</p>
            )}
          </CardContent>
        </Card>

        {/* Anuncios recientes — para todos los roles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4" aria-hidden />
              {t('cards.announcements.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {announcements.length === 0 ? (
              <p className="text-muted-foreground">{t('cards.announcements.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {announcements.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.team_id === null
                        ? t('cards.announcements.club_wide')
                        : (a.teams?.name ?? '—')}
                      {' · '}
                      {new Date(a.created_at).toLocaleDateString(locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Próximos eventos — jugador + coach */}
        {(isPlayer || isCoach) && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="size-4" aria-hidden />
                {t('cards.upcoming.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {upcomingEvents.length === 0 ? (
                <p className="text-muted-foreground">{t('cards.upcoming.empty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {upcomingEvents.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{e.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(`cards.upcoming.kind.${e.type}`)}
                          {' · '}
                          {new Date(e.starts_at).toLocaleString(locale)}
                          {e.teams?.name && ` · ${e.teams.name}`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Convocatorias pendientes a publicar — coach */}
        {isCoach && pendingCallupsCount > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="size-4" aria-hidden />
                {t('cards.coach_callups.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <Link href="/convocatorias" className="text-misterfc-green hover:underline">
                {t('cards.coach_callups.cta', { count: pendingCallupsCount })}
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Admin / coord dashboard placeholder */}
        {isAdminLike && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t('next_steps_title')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>{t('next_steps_body')}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
