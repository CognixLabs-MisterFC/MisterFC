import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  Calendar,
  ClipboardCheck,
  Megaphone,
  MessageSquare,
  LayoutDashboard,
} from 'lucide-react';
import {
  MATCH_SURFACE_TYPES,
  createSupabaseServerClient,
  ADMIN_ROLES,
  COACH_ROLES as CORE_COACH_ROLES,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NextMatchPanel } from './next-match-panel';
import { TrainingAlertPanel } from './training-alert-panel';
import { CampaignAlertPanel } from './campaign-alert-panel';
import { NotificationsPanel } from './notifications-panel';
import { DireccionHome } from './direccion-home';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ team?: string; coach?: string }>;
};

const COACH_ROLES = new Set<string>(CORE_COACH_ROLES);
const ADMIN_LIKE_ROLES = new Set<string>(ADMIN_ROLES);

export default async function Home({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
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
  // F14E-2 — DIRECCIÓN = admin_club + director (NO coordinador, cuyo Inicio se
  // decide en E-final; superadmin entra como admin_club sintético → incluido).
  const isDireccion = role === 'admin_club' || role === 'director';
  const clubId = ctx.activeClub.club.id;

  // ─── Datos para Cards ───
  const nowIso = new Date().toISOString();

  // Mensajes no leídos — todos los roles. Bug M: usa la RPC
  // `user_unread_conversations_count` (SECURITY DEFINER) por consistencia
  // con el badge del sidebar — la query directa sobre messages devolvía 0
  // para admin_club en runtime.
  const { data: unreadCountRpc } = await supabase.rpc(
    'user_unread_conversations_count',
  );
  const unreadConversations =
    typeof unreadCountRpc === 'number' ? unreadCountRpc : 0;

  // Anuncios recientes que el user ve (RLS filtra). Limitamos a últimos 7
  // días para que la card no acumule histórico — el link "Ver todos" lleva
  // a /es/anuncios para la lista completa filtrable.
  // eslint-disable-next-line react-hooks/purity
  const annHorizonIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: annRows } = await supabase
    .from('announcements')
    .select('id, title, body, pinned, team_id, club_id, created_at, teams(name)')
    .eq('club_id', clubId)
    .gte('created_at', annHorizonIso)
    .order('pinned', { ascending: false })
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
  // Bug J — la versión anterior usaba `head: true` + filtro embebido
  // `.is('match_callup_meta.published_at', null)` que PostgREST aplica a la
  // selección del embedded, no a la fila padre — por eso el count daba
  // todas las matches futuras o cero según el caso. Reescribimos:
  //   1. Obtenemos team_ids donde el coach es staff activo.
  //   2. Pedimos events type=match dentro del horizon de esos teams con
  //      match_callup_meta embebido.
  //   3. Filtramos en JS los que NO tienen meta o tienen meta sin
  //      published_at — esos son los que el coach debe convocar.
  // Bug J2 — horizon de 7d era demasiado corto: el siguiente partido suele
  // estar a 10-21 días. Usamos 60 días (igual que /mis-equipos).
  // eslint-disable-next-line react-hooks/purity
  const callupHorizonIso = new Date(Date.now() + 60 * 86_400_000).toISOString();
  let pendingCallupsCount = 0;
  if (isCoach) {
    const { data: staffRows } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', ctx.activeClub.membershipId)
      .is('left_at', null);
    const coachTeamIds = (staffRows ?? []).map((r) => r.team_id);

    if (coachTeamIds.length > 0) {
      const { data: matchRows } = await supabase
        .from('events')
        .select('id, match_callup_meta(published_at)')
        // F13B — amistoso también necesita convocatoria: cuenta como pendiente.
        .in('type', MATCH_SURFACE_TYPES)
        .gte('starts_at', nowIso)
        .lte('starts_at', callupHorizonIso)
        .in('team_id', coachTeamIds);
      type MatchRow = {
        id: string;
        match_callup_meta:
          | { published_at: string | null }
          | { published_at: string | null }[]
          | null;
      };
      pendingCallupsCount = ((matchRows ?? []) as unknown as MatchRow[]).filter(
        (e) => {
          const m = e.match_callup_meta;
          if (!m) return true;
          if (Array.isArray(m)) return m.length === 0 || !m[0]?.published_at;
          return !m.published_at;
        },
      ).length;
    }
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

      {/* F14E-2 — INICIO DE DIRECCIÓN (admin_club/director): tareas de los
          entrenadores club-wide + filtros + gestión. Sustituye para dirección a
          las alertas/novedades sueltas de abajo. */}
      {isDireccion && (
        <DireccionHome
          role={role}
          clubId={clubId}
          membershipId={ctx.activeClub.membershipId}
          isAdminClub={role === 'admin_club'}
          locale={locale}
          filters={{ teamId: sp.team, coachMembershipId: sp.coach }}
        />
      )}

      {/* F7.12 — Panel del próximo partido (coach) / aviso de convocatoria
          pendiente (jugador). Admin/coord no lo ven. */}
      <NextMatchPanel
        role={role as Parameters<typeof NextMatchPanel>[0]['role']}
        clubId={clubId}
        membershipId={ctx.activeClub.membershipId}
        locale={locale}
      />

      {/* F12.8b — Alerta de entrenamientos <48h sin sesión (coach = sus equipos;
          coordinador = club). Para DIRECCIÓN va dentro de DireccionHome (arriba). */}
      {!isDireccion && (
        <TrainingAlertPanel
          role={role}
          clubId={clubId}
          membershipId={ctx.activeClub.membershipId}
          locale={locale}
        />
      )}

      {/* F13.10g — Campaña con informes pendientes (coach = sus equipos;
          coordinador = club). Para DIRECCIÓN va dentro de DireccionHome (arriba). */}
      {!isDireccion && (
        <CampaignAlertPanel
          role={role}
          clubId={clubId}
          membershipId={ctx.activeClub.membershipId}
          locale={locale}
        />
      )}

      {/* F13.9a — Bandeja de novedades (feed in_app). F14E-2: FUERA del Inicio de
          dirección (incluye chat); coach/player/coordinador la siguen viendo. */}
      {!isDireccion && <NotificationsPanel locale={locale} />}

      {/* Grid de cards rol-aware */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Mensajes no leídos. F14E-2: es actividad de chat → FUERA del Inicio de
            dirección; coach/player/coordinador la siguen viendo. */}
        {!isDireccion && (
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
        )}

        {/* Anuncios recientes (últimos 7d) — para todos los roles */}
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
                  <li key={a.id}>
                    <Link
                      href={`/anuncios/${a.id}`}
                      className="flex flex-col gap-0.5 rounded-md p-1 -mx-1 hover:bg-zinc-900/50"
                    >
                      <span className="font-medium hover:text-misterfc-green">
                        {a.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.team_id === null
                          ? t('cards.announcements.club_wide')
                          : (a.teams?.name ?? '—')}
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

        {/* Enlace al dashboard ejecutivo (F10). F14E-2: FUERA del Inicio de
            dirección (el Dashboard es su entrada de menú /dashboard); se mantiene
            para el COORDINADOR (isAdminLike && !isDireccion), sin cambios. */}
        {isAdminLike && !isDireccion && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutDashboard className="size-4" aria-hidden />
                {t('dashboard_card.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="mb-2 text-muted-foreground">
                {t('dashboard_card.body')}
              </p>
              <Link
                href="/dashboard"
                className="text-misterfc-green hover:underline"
              >
                {t('dashboard_card.cta')}
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
