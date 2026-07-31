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
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/** Refresco del inbox (ms). Consistente con la web (polling 5s). */
const MESSAGES_POLL_MS = 5000;

/**
 * O2-5 E2a — Inbox de mensajes (SOLO LECTURA). Lista hilos 1:1 (los abre el
 * cuerpo técnico) + chats de equipo, con no-leídos, tal cual la web. La familia
 * NO inicia hilos → sin botón "nueva conversación". Es USER-scoped (los hilos
 * cuelgan del tutor, no del hijo): sin selector de hijo. Polling en foreground;
 * offline muestra el último inbox conocido. El envío es E2b.
 */
export function MensajesScreen() {
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

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <View className="px-4 pt-4">
        <ScreenTitle>{t('mensajes.title')}</ScreenTitle>
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
            <InboxRow
              item={item}
              accent={accent}
              onPress={() =>
                item.kind === 'direct'
                  ? router.push({
                      pathname: '/family/mensaje',
                      params: { conversationId: item.conversationId, title: item.title },
                    })
                  : router.push({
                      pathname: '/family/mensaje-equipo',
                      params: { teamConversationId: item.teamConversationId, title: item.title },
                    })
              }
            />
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
