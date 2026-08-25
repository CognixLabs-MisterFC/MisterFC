import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getInboxFromClient,
  getStaffInboxFromClient,
  profileScopedCacheKey,
  type InboxItem,
  type StaffInboxItem,
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

/** Fila fusionada: 1:1 familia / grupo de equipo / 1:1 staff (O2-12). */
type Row = InboxItem | StaffInboxItem;

/** Filtro de la bandeja. NO persiste entre sesiones. */
type Filter = 'todos' | 'club' | 'familias' | 'equipo';

/**
 * O2-10b-1a / O2-12 — Inbox de mensajes del STAFF (montada por /staff y /direction;
 * la familia usa OTRA pantalla). UNA SOLA bandeja: fusiona los hilos de familia+equipo
 * (`getInboxFromClient`) con los privados entre staff (`getStaffInboxFromClient`, inbox
 * HERMANO con forma paralela) y los ordena por fecha. Filtro de 4 (TODOS/CLUB/FAMILIAS/
 * EQUIPO), arranca en TODOS y NO persiste. El staff SÍ INICIA → cabecera "Nueva". Solo
 * lectura aquí; el envío va dentro de cada hilo. Cachés separadas (inbox / staff-inbox).
 */
export function StaffMensajesScreen({ basePath = '/staff' }: { basePath?: string }) {
  const t = useTranslations('');
  const { user } = useSession();
  const { theme } = useApp();
  const router = useRouter();
  const profileId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [filter, setFilter] = useState<Filter>('todos');

  const base = useCached<InboxItem[]>(
    profileScopedCacheKey('inbox', profileId ?? 'none'),
    (sb) => (profileId ? getInboxFromClient(sb, profileId) : Promise.resolve([])),
  );
  const staff = useCached<StaffInboxItem[]>(
    profileScopedCacheKey('staff-inbox', profileId ?? 'none'),
    (sb) => (profileId ? getStaffInboxFromClient(sb, profileId) : Promise.resolve([])),
  );
  useForegroundPoll(() => {
    base.refresh();
    staff.refresh();
  }, MESSAGES_POLL_MS);

  const openThread = (item: Row) => {
    if (item.kind === 'direct') {
      router.push({
        pathname: `${basePath}/mensaje`,
        params: { conversationId: item.conversationId, title: item.title },
      });
    } else if (item.kind === 'group') {
      router.push({
        pathname: `${basePath}/mensaje-equipo`,
        params: { teamConversationId: item.teamConversationId, title: item.title },
      });
    } else {
      router.push({
        pathname: `${basePath}/mensaje-staff`,
        params: { conversationId: item.conversationId, title: item.title },
      });
    }
  };

  if (base.loading || staff.loading) return <LoadingScreen />;

  // Fusión + orden por fecha (formas paralelas → sin traducir campos).
  const merged: Row[] = [...(base.data ?? []), ...(staff.data ?? [])].sort((a, b) =>
    a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0,
  );
  const rows = merged.filter((r) =>
    filter === 'todos'
      ? true
      : filter === 'club'
        ? r.kind === 'staff'
        : filter === 'familias'
          ? r.kind === 'direct'
          : r.kind === 'group',
  );

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'todos', label: t('mensajes_staff.filter_all') },
    { key: 'club', label: t('mensajes_staff.filter_club') },
    { key: 'familias', label: t('mensajes_staff.filter_families') },
    { key: 'equipo', label: t('mensajes_staff.filter_team') },
  ];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={base.fromCache || staff.fromCache} />
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

      {/* Filtro de 4 (no persiste). */}
      <View className="flex-row flex-wrap gap-2 px-4 pb-1 pt-2">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filter === f.key}
            accent={accent}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {rows.length === 0 ? (
        <EmptyState message={t('mensajes.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) =>
            it.kind === 'direct'
              ? `d-${it.conversationId}`
              : it.kind === 'group'
                ? `g-${it.teamConversationId}`
                : `s-${it.conversationId}`
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

function FilterChip({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full border px-3 py-1 active:opacity-80"
      style={{
        borderColor: active ? accent : '#E4E4E7',
        backgroundColor: active ? `${accent}14` : '#FFFFFF',
      }}
    >
      <Text className="text-xs font-medium" style={{ color: active ? accent : '#71717a' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function InboxRow({
  item,
  accent,
  onPress,
}: {
  item: Row;
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
        {item.kind === 'group' ? (
          <Text className="text-base">👥</Text>
        ) : item.kind === 'staff' ? (
          <Text className="text-base">🧑‍💼</Text>
        ) : null}
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
