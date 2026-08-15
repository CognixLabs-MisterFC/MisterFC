import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { invalidateAfterWrite } from '@/data/cache-resources';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { appLocale, useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

const MESSAGES_POLL_MS = 5000;

/**
 * O2-5 E2a — Hilo 1:1 (SOLO LECTURA). Leer mensajes + polling en foreground +
 * marcar leído (UPDATE read_at, permitido al cliente por RLS). El ENVÍO es E2b:
 * el composer va deshabilitado con nota. Caché por hilo (thread.${id}).
 */
export function MensajeDetalleScreen({
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

  const { data, fromCache, loading, refresh } = useCached<ConversationMessage[]>(
    eventScopedCacheKey('thread', conversationId ?? 'none'),
    (sb) =>
      conversationId
        ? getConversationMessagesFromClient(sb, conversationId)
        : Promise.resolve([]),
  );
  useForegroundPoll(refresh, MESSAGES_POLL_MS);

  // Envío 1:1: el endpoint hace el insert como el usuario (RLS) + fan-out. Tras el
  // ok, refrescamos (el polling lo confirmaría igual; refrescar lo hace inmediato).
  // Sin cola diferida: sin red el composer va deshabilitado.
  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      if (!conversationId) return false;
      try {
        const res = await callServerEndpoint('/api/messages/send', {
          method: 'POST',
          body: { kind: 'direct', conversationId, body: text, locale: appLocale() },
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

  // Marcar leído al abrir (y al reconectar): escritura de bajo riesgo por RLS.
  // Sin red se omite con gracia (se marcará al volver la conexión).
  useEffect(() => {
    if (!online || !conversationId || !userId) return;
    void markConversationReadFromClient(
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
            <Bubble key={m.id} message={m} mine={m.sender_profile_id === userId} accent={accent} />
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

/**
 * O2-5 F3 — Composer de envío (1:1 y equipo). `onSend` devuelve true si el endpoint
 * confirmó; tras el ok se limpia el input (el screen ya refrescó). Write-guard: sin
 * red, deshabilitado con aviso; sin cola diferida. La familia solo responde DENTRO
 * de un hilo existente (no hay "nueva conversación").
 */
export function Composer({
  online,
  accent,
  onSend,
}: {
  online: boolean;
  accent: string;
  onSend: (text: string) => Promise<boolean>;
}) {
  const t = useTranslations('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const canSend = online && !busy && text.trim().length > 0;

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!online || busy || trimmed.length === 0) return; // write-guard
    setBusy(true);
    setFailed(false);
    const ok = await onSend(trimmed);
    setBusy(false);
    if (ok) setText('');
    else setFailed(true);
  }, [text, online, busy, onSend]);

  return (
    <View className="border-t border-zinc-100 bg-white px-3 py-2">
      {failed ? (
        <Text className="mb-1 px-1 text-xs text-red-600">{t('mensajes.errors.generic')}</Text>
      ) : null}
      {!online ? (
        <Text className="mb-1 px-1 text-xs text-zinc-400">{t('mensajes.send_offline')}</Text>
      ) : null}
      <View className="flex-row items-end gap-2">
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (failed) setFailed(false);
          }}
          placeholder={t('mensajes.send_placeholder')}
          placeholderTextColor="#a1a1aa"
          editable={online && !busy}
          multiline
          maxLength={2000}
          className="max-h-28 flex-1 rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          className="rounded-full px-4 py-2 active:opacity-80"
          style={{ backgroundColor: accent, opacity: canSend ? 1 : 0.5 }}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-semibold text-white">{t('mensajes.thread.send')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
