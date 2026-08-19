import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  getUnreadConversationsCountFromClient,
  getPlayerPendingCallupFromClient,
  getUpcomingEventsFromClient,
  getUnreadAnnouncementsFromClient,
  getUnreadNotificationsFeedFromClient,
  markNotificationReadFromClient,
  notificationFeedText,
  type UpcomingEvent,
  type PlayerPendingCallup,
  type AnnouncementRow,
  type NotificationFeedRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { supabase } from '@/lib/supabase';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { familyEventTarget, familyFeedTarget, type FamilyTarget } from '@/notifications/feed-target';

const DAY = 86_400_000;

type HomeData = {
  unread: number;
  pending: PlayerPendingCallup;
  upcoming: UpcomingEvent[];
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
      const [unread, pending, upcoming, announcements, feed] = await Promise.all([
        getUnreadConversationsCountFromClient(sb),
        getPlayerPendingCallupFromClient(sb, playerIds),
        getUpcomingEventsFromClient(sb, nowIso, new Date(now + 7 * DAY).toISOString()),
        // Punto 7 — SOLO anuncios sin leer; al abrirlos (/anuncios los marca
        // leídos) desaparecen del inicio. Ya no salen en el feed de novedades.
        getUnreadAnnouncementsFromClient(sb, clubId, 5),
        // Punto 3 — el inicio muestra SOLO novedades sin leer (al leerlas
        // desaparecen). La pantalla /novedades conserva sus pestañas (#474).
        getUnreadNotificationsFeedFromClient(sb, 10),
      ]);
      return { unread, pending, upcoming, announcements, feed };
    },
  );

  if (loading) return <LoadingScreen />;
  const d = data ?? { unread: 0, pending: null, upcoming: [], announcements: [], feed: [] };

  const go = (target: FamilyTarget) => {
    if (target) router.push(target as Href);
  };

  // Al tocar una novedad: navega Y la marca como leída (además de navegar), para
  // que el contador de no leídos siga coherente. Fire-and-forget + invalidación.
  const openFeed = (n: NotificationFeedRow) => {
    const target = familyFeedTarget(n.type, n.payload);
    if (!target) return; // sin destino → fila no clicable
    if (n.status === 'pending') {
      void markNotificationReadFromClient(supabase, n.id).then(() =>
        invalidateAfterWrite('markNotifications'),
      );
    }
    router.push(target as Href);
  };

  // Punto 6 — un SOLO evento: el más próximo. Destino = el mismo familyEventTarget.
  const nextEvent = d.upcoming[0] ?? null;
  const nextEventTarget = nextEvent ? familyEventTarget(nextEvent) : null;

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

        {/* Punto 6 — tarjeta ANCHA del próximo evento (fecha/hora en grande), lo
            primero tras el saludo, encima de la rejilla. Sustituye a la antigua
            lista "Próximos eventos" (redundante con el calendario). */}
        <Pressable
          onPress={nextEventTarget ? () => go(nextEventTarget) : undefined}
          disabled={!nextEventTarget}
          className="rounded-2xl border border-zinc-200 p-4 active:opacity-70"
          style={{ borderLeftWidth: 4, borderLeftColor: accent }}
        >
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('inicio.next_event')}
          </Text>
          {nextEvent ? (
            <>
              <Text className="mt-1 text-2xl font-extrabold capitalize text-[#0F1B2E]">
                {new Date(nextEvent.starts_at).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </Text>
              <Text className="text-xl font-bold text-[#0F1B2E] tabular-nums">
                {new Date(nextEvent.starts_at).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Text className="mt-1 text-sm text-zinc-600" numberOfLines={2}>
                {t(`calendario.types.${nextEvent.type}`)}
                {nextEvent.title ? ` · ${nextEvent.title}` : ''}
              </Text>
            </>
          ) : (
            <Text className="mt-1 text-sm text-zinc-400">{t('inicio.empty_upcoming')}</Text>
          )}
        </Pressable>

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

        <Section title={t('inicio.section_feed')}>
          {d.feed.length === 0 ? (
            <Muted text={t('inicio.empty_feed')} />
          ) : (
            d.feed.map((n) => {
              const clickable = familyFeedTarget(n.type, n.payload) != null;
              return (
                <Row
                  key={n.id}
                  title={notificationFeedText(tFeed, n.type, n.payload)}
                  sub={n.created_at.slice(0, 10)}
                  unread={n.status === 'pending'}
                  onPress={clickable ? () => openFeed(n) : undefined}
                />
              );
            })
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
}: {
  title: string;
  sub: string;
  unread?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      {unread ? <View className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
      <View className="flex-1">
        <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>{title}</Text>
        {sub ? <Text className="text-xs text-zinc-400">{sub}</Text> : null}
      </View>
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
