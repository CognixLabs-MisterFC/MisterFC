import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getInboxFromClient,
  countUnreadConversations,
  getPlayerPendingCallupFromClient,
  getNextEventPerPlayerFromClient,
  getUnreadAnnouncementsFromClient,
  getUnreadNotificationsFeedFromClient,
  markNotificationReadFromClient,
  notificationFeedText,
  type UpcomingEvent,
  type PlayerNextEvent,
  type PlayerPendingCallup,
  type AnnouncementRow,
  type NotificationFeedRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { supabase } from '@/lib/supabase';
import { reportDataError, reportDataSignal } from '@/lib/report-error';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { familyEventTarget, familyFeedTarget, type FamilyTarget } from '@/notifications/feed-target';

const DAY = 86_400_000;

/**
 * Iconos por tipo de evento: los MISMOS que ya usan el inicio de staff
 * (screens/staff/inicio.tsx) y el calendario (screens/family/calendario.tsx).
 * Copia local (el patrón del repo es una por pantalla); no se inventan otros.
 */
const TYPE_ICON: Record<string, string> = {
  training: '🏋️',
  match: '⚽',
  friendly: '⚽',
  tournament: '🏆',
  other: '📌',
};

/** "Viernes, 21 de agosto · 18:00" — fecha (primera letra en mayúscula) + hora. */
function formatEventWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${time}`;
}

/**
 * Tarjeta ANCHA del próximo evento (Punto 6). Mismo diseño de siempre; lo único
 * que cambia es la cabecera: con UN hijo dice "Próximo evento" (idéntico a antes)
 * y con VARIOS el nombre del hijo, para distinguir las tarjetas.
 *
 * Jerarquía: lo más grande es QUÉ es el evento (icono + tipo/título), luego
 * fecha·hora en tamaño medio y el equipo en pequeño.
 */
function NextEventCard({
  heading,
  event,
  accent,
  onPress,
}: {
  heading: string;
  event: UpcomingEvent | null;
  accent: string;
  onPress: (() => void) | null;
}) {
  const t = useTranslations('');
  // Sin duplicar: el tipo (catálogo compartido) es el titular. Si el evento trae
  // título propio DISTINTO del tipo (p. ej. un amistoso "Fonteta vs Amistat"),
  // ese título sustituye al tipo como titular.
  const typeLabel = event ? t(`calendario.types.${event.type}`) : '';
  const ownTitle = event?.title?.trim();
  const headline = ownTitle && ownTitle !== typeLabel ? ownTitle : typeLabel;

  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={!onPress}
      className="rounded-2xl border border-zinc-200 p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {heading}
      </Text>
      {event ? (
        <>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="text-2xl">{TYPE_ICON[event.type] ?? '📌'}</Text>
            <Text
              className="flex-1 text-xl font-extrabold uppercase text-[#0F1B2E]"
              numberOfLines={2}
            >
              {headline}
            </Text>
          </View>
          <Text className="mt-2 text-base font-semibold text-[#0F1B2E] tabular-nums">
            {formatEventWhen(event.starts_at)}
          </Text>
          {event.teamName ? (
            <Text className="text-sm text-zinc-500">{event.teamName}</Text>
          ) : null}
        </>
      ) : (
        <Text className="mt-1 text-sm text-zinc-400">{t('inicio.empty_upcoming')}</Text>
      )}
    </Pressable>
  );
}

type HomeData = {
  unread: number;
  pending: PlayerPendingCallup;
  /** Una entrada POR HIJO, en el orden en que llegan; `event` null = sin eventos. */
  upcoming: PlayerNextEvent[];
  announcements: AnnouncementRow[];
  feed: NotificationFeedRow[];
};

/**
 * O2-5 B1 — Inicio de familia: mensajes sin leer, convocatoria pendiente del
 * hijo, tarjeta del próximo evento, anuncios del club SIN LEER y novedades SIN
 * LEER. Todo agregado (sin selector de hijo); la convocatoria usa los IDs de
 * todos los hijos.
 */
/** Accesos rápidos del inicio del jugador (rejilla), en el orden pedido por Jose. */
const HOME_TILES: { icon: string; labelKey: string; href: string }[] = [
  { icon: '🛡️', labelKey: 'shell.nav.mi_equipo', href: '/family/mi-equipo' },
  { icon: '⚽', labelKey: 'nav.partidos', href: '/family/convocatorias' },
  { icon: '🏋️', labelKey: 'entrenamientos.title', href: '/family/entrenamientos' },
  { icon: '📋', labelKey: 'playbook.title', href: '/family/jugadas' },
];

export function InicioScreen() {
  const t = useTranslations('');
  const tFeed = useTranslations('home.feed');
  const { activeClub, profileName, theme } = useApp();
  const { players } = useActivePlayer();
  const { user } = useSession();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const accent = theme?.color ?? BRAND.navy;

  // Clave por CUENTA DEL TUTOR (user.id = profiles.id), no por la lista de ids de
  // los hijos: `playerIds.join(',')` metía comas (inválidas en secure-store) y
  // generaba entradas distintas según el orden/altas de hijos. El tutor identifica
  // unívocamente a la familia y es estable. Se mantiene el clubId para no servir
  // offline la caché de otro club (norma O2-5). Una sola entrada por (club, tutor).
  const { data, fromCache, loading } = useCached<HomeData>(
    `inicio.${clubId ?? 'none'}.${user?.id ?? 'anon'}`,
    async (sb) => {
      if (!clubId) {
        return { unread: 0, pending: null, upcoming: [], announcements: [], feed: [] };
      }
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const toIso = new Date(now + 7 * DAY).toISOString();
      const [unread, pending, upcoming, announcements, feed] = await Promise.all([
        // Punto 11 — nº de CONVERSACIONES con no leídos (1:1 + equipo), derivado del
        // MISMO inbox que la lista y el badge de la pestaña → los tres dicen lo mismo.
        user?.id
          ? getInboxFromClient(sb, user.id).then(countUnreadConversations)
          : Promise.resolve(0),
        getPlayerPendingCallupFromClient(sb, playerIds),
        // El próximo evento DE CADA HIJO, acotado a SUS equipos. Antes se pedían los
        // eventos sin filtro y se cogía el primero: como la RLS abre los partidos a
        // todo el club (F7B-2), a una familia del Alevín le salía uno del Infantil B.
        // INSTRUMENTACIÓN — sink onError (#488): un fallo de RLS/Postgres deja rastro
        // en Sentry en vez de un `[]` mudo.
        getNextEventPerPlayerFromClient(sb, clubId, playerIds, nowIso, toIso, (e) =>
          reportDataError('upcoming-events', e),
        ),
        // Punto 7 — SOLO anuncios sin leer; al abrirlos (/anuncios los marca
        // leídos) desaparecen del inicio. Ya no salen en el feed de novedades.
        getUnreadAnnouncementsFromClient(sb, clubId, 5),
        // Punto 3 — el inicio muestra SOLO novedades sin leer (al leerlas
        // desaparecen). La pantalla /novedades conserva sus pestañas (#474).
        getUnreadNotificationsFeedFromClient(sb, 10),
      ]);
      // INSTRUMENTACIÓN — este bloque SOLO corre en fetch FRESCO (readThrough no
      // ejecuta el fetcher al servir caché) → refleja lo que devuelve la consulta VIVA:
      // cuántos próximos eventos y el más cercano, con la ventana usada.
      reportDataSignal('inicio-upcoming', {
        phase: 'fetch',
        // `count` = hijos con tarjeta; `withEvent` = cuántas traen evento. Sin el
        // segundo, "dos tarjetas vacías" y "dos tarjetas llenas" serían el mismo 2.
        count: upcoming.length,
        withEvent: upcoming.filter((u) => u.event != null).length,
        first: upcoming.find((u) => u.event != null)?.event?.starts_at ?? 'none',
        from: nowIso.slice(0, 10),
        to: toIso.slice(0, 10),
      });
      return { unread, pending, upcoming, announcements, feed };
    },
  );

  // INSTRUMENTACIÓN — señal del valor SERVIDO al render (cada vez que cambia `data`:
  // primero el de caché, luego el de la revalidación). `fromCache=true` solo en
  // OFFLINE; el timeline (render vs fetch) revela si lo servido es caché stale o fresco.
  useEffect(() => {
    if (loading || !data) return;
    reportDataSignal('inicio-upcoming', {
      phase: 'render',
      fromCache,
      count: data.upcoming.length,
      withEvent: data.upcoming.filter((u) => u.event != null).length,
      first: data.upcoming.find((u) => u.event != null)?.event?.starts_at ?? 'none',
    });
  }, [data, fromCache, loading]);

  if (loading) return <LoadingScreen />;
  const d = data ?? { unread: 0, pending: null, upcoming: [], announcements: [], feed: [] };

  const go = (target: FamilyTarget) => {
    if (target) router.push(target as Href);
  };

  // Marca una novedad como leída (fire-and-forget + invalidación). Al leerla
  // desaparece del inicio (getUnread… deja de traerla) y el badge sigue coherente.
  const markFeedRead = (id: string) => {
    void markNotificationReadFromClient(supabase, id).then(() =>
      invalidateAfterWrite('markNotifications'),
    );
  };

  // Al tocar una novedad CON destino: navega Y la marca como leída, para que el
  // contador de no leídos siga coherente. Las filas SIN destino no navegan: se
  // marcan con el botón "marcar leída" (mismo patrón que la pantalla Novedades, #474).
  const openFeed = (n: NotificationFeedRow) => {
    const target = familyFeedTarget(n.type, n.payload);
    if (!target) return; // sin destino → fila no clicable
    if (n.status === 'pending') markFeedRead(n.id);
    router.push(target as Href);
  };

  // Punto 6 (revisión) — UNA TARJETA POR HIJO, cada una con el próximo evento de
  // SUS equipos. Con un solo hijo queda una tarjeta, idéntica a como estaba.
  // Con varios, la cabecera pasa a ser el nombre para poder distinguirlas.
  // Dos hermanos del MISMO equipo verán el MISMO evento: es correcto, comparten
  // calendario.
  const nameOf = (playerId: string) =>
    players.find((p) => p.id === playerId)?.name ?? t('inicio.next_event');
  const cards = d.upcoming.map((u) => ({
    playerId: u.playerId,
    heading: d.upcoming.length > 1 ? nameOf(u.playerId) : t('inicio.next_event'),
    event: u.event,
    target: u.event ? familyEventTarget(u.event) : null,
  }));

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <Text className="text-2xl font-bold text-[#0F1B2E]">
          {t('home.greeting', { name: profileName ?? '' }).trim()}
        </Text>
        {theme?.clubName ? (
          <Text className="text-sm text-zinc-400">{theme.clubName}</Text>
        ) : null}

        {cards.map((c) => (
          <NextEventCard
            key={c.playerId}
            heading={c.heading}
            event={c.event}
            accent={accent}
            onPress={c.target ? () => go(c.target) : null}
          />
        ))}

        {/* Rejilla de accesos rápidos (espeja el inicio de staff). */}
        <View className="flex-row flex-wrap gap-2 pt-1">
          {HOME_TILES.map((tile) => (
            <Tile
              key={tile.href}
              icon={tile.icon}
              label={t(tile.labelKey)}
              accent={accent}
              onPress={() => router.push(tile.href)}
            />
          ))}
        </View>

        {d.unread > 0 ? (
          <Card accent={accent}>
            <Text className="text-sm font-medium text-[#0F1B2E]">
              {t('inicio.unread_messages', { n: String(d.unread) })}
            </Text>
          </Card>
        ) : null}

        {d.pending ? (
          <Card accent="#dc2626">
            <Text className="text-sm font-semibold text-[#0F1B2E]">
              {t('inicio.pending_callup')}
            </Text>
            <Text className="text-xs text-zinc-500">
              {`${d.pending.title} · ${t('inicio.pending_callup_count', { n: String(d.pending.pendingCount) })}`}
            </Text>
          </Card>
        ) : null}

        {d.announcements.length > 0 ? (
          <Section title={t('inicio.section_announcements')}>
            {d.announcements.map((a) => (
              <Row
                key={a.id}
                title={a.title}
                sub={a.teamName ?? ''}
                unread
                onPress={() => router.push('/family/anuncios')}
              />
            ))}
          </Section>
        ) : null}

        {/* J2 — en el inicio se muestran como MÁXIMO 3 novedades sin leer; si hay
            más, un acceso a la pantalla Novedades (pestañas "Sin leer"/"Todas",
            #474). Cada fila puede marcarse leída: las que tienen destino, al tocarlas
            (navegan y marcan); las que NO tienen destino, con el botón "marcar leída"
            (mismo patrón que Novedades). Al leerlas desaparecen del inicio (#480). */}
        <Section title={t('inicio.section_feed')}>
          {d.feed.length === 0 ? (
            <Muted text={t('inicio.empty_feed')} />
          ) : (
            <>
              {d.feed.slice(0, 3).map((n) => {
                const clickable = familyFeedTarget(n.type, n.payload) != null;
                const pending = n.status === 'pending';
                return (
                  <Row
                    key={n.id}
                    title={notificationFeedText(tFeed, n.type, n.payload)}
                    sub={n.created_at.slice(0, 10)}
                    unread={pending}
                    onPress={clickable ? () => openFeed(n) : undefined}
                    onMarkRead={!clickable && pending ? () => markFeedRead(n.id) : undefined}
                    markReadLabel={t('novedades.mark_read')}
                  />
                );
              })}
              {d.feed.length > 3 ? (
                <Pressable
                  onPress={() => router.push('/family/novedades')}
                  className="items-end py-2 active:opacity-60"
                >
                  <Text className="text-xs font-medium text-emerald-600">{tFeed('view_all')}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

/** Tile de navegación de la rejilla del inicio (mismo patrón visual que staff). */
function Tile({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: string;
  label: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-w-[46%] flex-1 flex-row items-center gap-2 rounded-2xl border border-zinc-200 p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <Text className="text-lg">{icon}</Text>
      <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function Card({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4" style={{ borderLeftWidth: 4, borderLeftColor: accent }}>
      {children}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}

function Row({
  title,
  sub,
  unread,
  onPress,
  onMarkRead,
  markReadLabel,
}: {
  title: string;
  sub: string;
  unread?: boolean;
  onPress?: () => void;
  /** J2 — botón "marcar leída" para filas SIN destino (no navegables). Solo se
   * pasa cuando la fila no es clicable y está pendiente (patrón de Novedades #474). */
  onMarkRead?: () => void;
  markReadLabel?: string;
}) {
  const content = (
    <>
      {unread ? <View className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
      <View className="flex-1">
        <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>{title}</Text>
        {sub ? <Text className="text-xs text-zinc-400">{sub}</Text> : null}
      </View>
      {onMarkRead ? (
        <Pressable
          onPress={onMarkRead}
          hitSlop={8}
          className="ml-2 rounded-full border border-zinc-200 px-2 py-1 active:opacity-60"
        >
          <Text className="text-[11px] font-medium text-zinc-500">{markReadLabel}</Text>
        </Pressable>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center gap-2 border-b border-zinc-100 py-2 active:opacity-60"
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View className="flex-row items-center gap-2 border-b border-zinc-100 py-2">{content}</View>
  );
}

function Muted({ text }: { text: string }) {
  return <Text className="py-2 text-sm text-zinc-400">{text}</Text>;
}
