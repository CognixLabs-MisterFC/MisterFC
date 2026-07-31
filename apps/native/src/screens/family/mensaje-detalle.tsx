import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getConversationMessagesFromClient,
  markConversationReadFromClient,
  eventScopedCacheKey,
  type ConversationMessage,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

const MESSAGES_POLL_MS = 5000;

/**
 * O2-5 E2a — Hilo 1:1 (SOLO LECTURA). Leer mensajes + polling en foreground +
 * marcar leído (UPDATE read_at, permitido al cliente por RLS). El ENVÍO es E2b:
 * el composer va deshabilitado con nota. Caché por hilo (thread::${id}).
 */
export function MensajeDetalleScreen({
  conversationId,
  title,
}: {
  conversationId: string | null;
  title: string | null;
}) {
  const { user } = useSession();
  const { theme } = useApp();
  const online = useIsOnline();
  const userId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<ConversationMessage[]>(
    eventScopedCacheKey('thread', conversationId ?? 'none'),
    (sb) =>
      conversationId
        ? getConversationMessagesFromClient(sb, conversationId)
        : Promise.resolve([]),
  );
  useForegroundPoll(refresh, MESSAGES_POLL_MS);

  // Marcar leído al abrir (y al reconectar): escritura de bajo riesgo por RLS.
  // Sin red se omite con gracia (se marcará al volver la conexión).
  useEffect(() => {
    if (!online || !conversationId || !userId) return;
    void markConversationReadFromClient(
      supabase,
      conversationId,
      userId,
      new Date().toISOString(),
    );
  }, [online, conversationId, userId]);

  if (!conversationId) return <EmptyState message={t('mensajes.unavailable')} />;
  if (loading) return <LoadingScreen />;
  const messages = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      {title ? (
        <View className="border-b border-zinc-100 px-4 py-3">
          <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
            {title}
          </Text>
        </View>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState message={t('mensajes.thread_empty')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {messages.map((m) => (
            <Bubble key={m.id} message={m} mine={m.sender_profile_id === userId} accent={accent} />
          ))}
        </ScrollView>
      )}

      {/* Composer deshabilitado — el envío es E2b. */}
      <DisabledComposer />
    </View>
  );
}

function Bubble({
  message,
  mine,
  accent,
}: {
  message: ConversationMessage;
  mine: boolean;
  accent: string;
}) {
  return (
    <View className={mine ? 'items-end' : 'items-start'}>
      <View
        className="max-w-[80%] rounded-2xl px-3 py-2"
        style={mine ? { backgroundColor: accent } : { backgroundColor: '#f4f4f5' }}
      >
        <Text className={mine ? 'text-sm text-white' : 'text-sm text-[#0F1B2E]'}>{message.body}</Text>
      </View>
      <Text className="mt-0.5 text-[10px] text-zinc-400">
        {new Date(message.sent_at).toLocaleString()}
      </Text>
    </View>
  );
}

/** O2-5 E2a — placeholder del composer; el envío llega en E2b. */
export function DisabledComposer() {
  return (
    <View className="border-t border-zinc-100 bg-zinc-50 px-4 py-3">
      <View className="rounded-full border border-zinc-200 bg-white px-4 py-2 opacity-60">
        <Text className="text-sm text-zinc-400">{t('mensajes.send_soon')}</Text>
      </View>
    </View>
  );
}
