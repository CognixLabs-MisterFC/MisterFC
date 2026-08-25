import { useCallback, useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getStaffConversationMessagesFromClient,
  markStaffConversationReadFromClient,
  eventScopedCacheKey,
  type StaffThreadMessage,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { appLocale, useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { Composer } from '@/screens/family/mensaje-detalle';

const MESSAGES_POLL_MS = 5000;

/**
 * O2-12 — Hilo 1:1 PRIVADO entre STAFF. Leer mensajes + polling en foreground +
 * marcar leído (upsert de staff_conversation_reads, permitido por RLS) + enviar
 * (endpoint `kind:'staff'`, que inserta como el usuario y hace fan-out SOLO al otro).
 * APPEND-ONLY: no se edita ni se borra. Caché por hilo con NAMESPACE propio
 * (`staff-thread.${id}`). Reusa el `Composer` del hilo de familia (presentacional) sin
 * tocar aquella pantalla. El envío sin red va deshabilitado (sin cola diferida).
 */
export function MensajeStaffScreen({
  conversationId,
  title,
}: {
  conversationId: string | null;
  title: string | null;
}) {
  const t = useTranslations('');
  const { user } = useSession();
  const { theme } = useApp();
  const online = useIsOnline();
  const userId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<StaffThreadMessage[]>(
    eventScopedCacheKey('staff-thread', conversationId ?? 'none'),
    (sb) =>
      conversationId
        ? getStaffConversationMessagesFromClient(sb, conversationId)
        : Promise.resolve([]),
  );
  useForegroundPoll(refresh, MESSAGES_POLL_MS);

  // Envío: el endpoint hace el insert como el usuario (RLS) + fan-out al otro. Tras el
  // ok refrescamos. Sin cola diferida: sin red el composer va deshabilitado.
  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      if (!conversationId) return false;
      try {
        const res = await callServerEndpoint('/api/messages/send', {
          method: 'POST',
          body: { kind: 'staff', conversationId, body: text, locale: appLocale() },
        });
        if (!res.ok) return false;
        refresh();
        void invalidateAfterWrite('sendMessage');
        return true;
      } catch {
        return false;
      }
    },
    [conversationId, refresh],
  );

  // Marcar leído al abrir (y al reconectar). Sin red se omite con gracia.
  useEffect(() => {
    if (!online || !conversationId || !userId) return;
    void markStaffConversationReadFromClient(
      supabase,
      conversationId,
      userId,
      new Date().toISOString(),
    ).then(() => {
      void invalidateAfterWrite('markConversationRead');
    });
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
            <Bubble
              key={m.id}
              message={m}
              mine={m.sender_profile_id === userId}
              accent={accent}
            />
          ))}
        </ScrollView>
      )}

      <Composer online={online} accent={accent} onSend={onSend} />
    </View>
  );
}

function Bubble({
  message,
  mine,
  accent,
}: {
  message: StaffThreadMessage;
  mine: boolean;
  accent: string;
}) {
  return (
    <View className={mine ? 'items-end' : 'items-start'}>
      <View
        className="max-w-[80%] rounded-2xl px-3 py-2"
        style={mine ? { backgroundColor: accent } : { backgroundColor: '#f4f4f5' }}
      >
        <Text className={mine ? 'text-sm text-white' : 'text-sm text-[#0F1B2E]'}>
          {message.body}
        </Text>
      </View>
      <Text className="mt-0.5 text-[10px] text-zinc-400">
        {new Date(message.created_at).toLocaleString()}
      </Text>
    </View>
  );
}
