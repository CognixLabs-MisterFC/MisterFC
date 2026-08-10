import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getInboxFromClient,
  profileScopedCacheKey,
  type InboxItem,
} from '@misterfc/core';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Refresco del inbox (ms). Consistente con la web y con familia (polling 5s). */
const MESSAGES_POLL_MS = 5000;

/**
 * O2-10b-1a — Inbox de mensajes del STAFF. Reutiliza la lectura E2a
 * (`getInboxFromClient`, USER-scoped, RLS filtra a los hilos del usuario) y los hilos
 * 1:1 / de equipo. A diferencia de la familia, el staff SÍ INICIA → cabecera con
 * "Nueva conversación" (→ /staff/mensaje-nuevo). Solo lectura aquí; el envío reutiliza
 * el endpoint F3 dentro de cada hilo. Offline muestra el último inbox conocido.
 */
export function StaffMensajesScreen({ basePath = '/staff' }: { basePath?: string }) {
  const t = useTranslations('');
  const { user } = useSession();
  const { theme } = useApp();
  const router = useRouter();
  const profileId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<InboxItem[]>(
    profileScopedCacheKey('inbox', profileId ?? 'none'),
    (sb) => (profileId ? getInboxFromClient(sb, profileId) : Promise.resolve([])),
  );
  useForegroundPoll(refresh, MESSAGES_POLL_MS);

  const openThread = (item: InboxItem) =>
    item.kind === 'direct'
      ? router.push({
          pathname: `${basePath}/mensaje`,
          params: { conversationId: item.conversationId, title: item.title },
        })
      : router.push({
          pathname: `${basePath}/mensaje-equipo`,
          params: { teamConversationId: item.teamConversationId, title: item.title },
        });

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <View className="flex-row items-center justify-between px-4 pt-4">
        <ScreenTitle>{t('mensajes.title')}</ScreenTitle>
        <Pressable
          onPress={() => router.push(`${basePath}/mensaje-nuevo`)}
          className="flex-row items-center gap-1 rounded-full px-3 py-1.5 active:opacity-80"
          style={{ backgroundColor: accent }}
        >
          <Text className="text-sm font-semibold text-white">＋ {t('mensajes_staff.new')}</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <EmptyState message={t('mensajes.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) =>
            it.kind === 'direct' ? `d-${it.conversationId}` : `g-${it.teamConversationId}`
          }
          contentContainerStyle={{ padding: 16, gap: 4 }}
          renderItem={({ item }) => (
            <InboxRow item={item} accent={accent} onPress={() => openThread(item)} />
          )}
        />
      )}
    </View>
  );
}

function InboxRow({
  item,
  accent,
  onPress,
}: {
  item: InboxItem;
  accent: string;
  onPress: () => void;
}) {
  const t = useTranslations('');
  const title =
    item.kind === 'group' ? t('mensajes.group_label', { team: item.title }) : item.title;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between gap-3 border-b border-zinc-100 py-3 active:opacity-70"
    >
      <View className="flex-1 flex-row items-center gap-2">
        {item.kind === 'group' ? <Text className="text-base">👥</Text> : null}
        <View className="flex-1">
          <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {new Date(item.lastMessageAt).toLocaleString()}
          </Text>
        </View>
      </View>
      {item.unread > 0 ? (
        <View
          className="h-6 min-w-6 items-center justify-center rounded-full px-2"
          style={{ backgroundColor: accent }}
        >
          <Text className="text-xs font-semibold text-white">{item.unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
