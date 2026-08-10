import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getUnreadConversationsCountFromClient,
  getPlayerPendingCallupFromClient,
  getUpcomingEventsFromClient,
  getRecentAnnouncementsFromClient,
  getNotificationFeedFromClient,
  type UpcomingEvent,
  type PlayerPendingCallup,
  type AnnouncementRow,
  type NotificationFeedRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

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
 * hijo, próximos eventos, anuncios recientes y feed de novedades. Todo agregado
 * (sin selector de hijo); la convocatoria usa los IDs de todos los hijos.
 */
export function InicioScreen() {
  const t = useTranslations('');
  const { activeClub, profileName, theme } = useApp();
  const { players } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<HomeData>(
    `inicio::${clubId ?? 'none'}::${playerIds.join(',')}`,
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
        getRecentAnnouncementsFromClient(sb, clubId, {
          sinceIso: new Date(now - 7 * DAY).toISOString(),
          limit: 5,
        }),
        getNotificationFeedFromClient(sb, 6),
      ]);
      return { unread, pending, upcoming, announcements, feed };
    },
  );

  if (loading) return <LoadingScreen />;
  const d = data ?? { unread: 0, pending: null, upcoming: [], announcements: [], feed: [] };

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

        <Section title={t('inicio.section_upcoming')}>
          {d.upcoming.length === 0 ? (
            <Muted text={t('inicio.empty_upcoming')} />
          ) : (
            d.upcoming.map((e) => (
              <Row key={e.id} title={e.title} sub={`${e.starts_at.slice(5, 16).replace('T', ' ')}${e.teamName ? ' · ' + e.teamName : ''}`} />
            ))
          )}
        </Section>

        {d.announcements.length > 0 ? (
          <Section title={t('inicio.section_announcements')}>
            {d.announcements.map((a) => (
              <Row key={a.id} title={a.title} sub={a.teamName ?? ''} />
            ))}
          </Section>
        ) : null}

        <Section title={t('inicio.section_feed')}>
          {d.feed.length === 0 ? (
            <Muted text={t('inicio.empty_feed')} />
          ) : (
            d.feed.map((n) => (
              <Row key={n.id} title={n.type} sub={n.created_at.slice(0, 10)} unread={n.status === 'pending'} />
            ))
          )}
        </Section>
      </ScrollView>
    </View>
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

function Row({ title, sub, unread }: { title: string; sub: string; unread?: boolean }) {
  return (
    <View className="flex-row items-center gap-2 border-b border-zinc-100 py-2">
      {unread ? <View className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
      <View className="flex-1">
        <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>{title}</Text>
        {sub ? <Text className="text-xs text-zinc-400">{sub}</Text> : null}
      </View>
    </View>
  );
}

function Muted({ text }: { text: string }) {
  return <Text className="py-2 text-sm text-zinc-400">{text}</Text>;
}
