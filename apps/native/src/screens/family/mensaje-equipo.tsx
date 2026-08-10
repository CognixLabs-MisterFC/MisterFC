import { useCallback, useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getTeamMessagesFromClient,
  markTeamConversationReadFromClient,
  eventScopedCacheKey,
  type TeamThreadMessage,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { Composer } from './mensaje-detalle';
import { appLocale } from '@/i18n';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

const MESSAGES_POLL_MS = 5000;

/**
 * O2-5 E2a — Hilo de EQUIPO (SOLO LECTURA). Leer + polling + marcar leído (upsert
 * team_conversation_reads, permitido por RLS). El ENVÍO es E2b: composer
 * deshabilitado. Caché por hilo de equipo (team-thread::${id}).
 */
export function MensajeEquipoScreen({
  teamConversationId,
  title,
}: {
  teamConversationId: string | null;
  title: string | null;
}) {
  const t = useTranslations('');
  const { user } = useSession();
  const { theme } = useApp();
  const online = useIsOnline();
  const userId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<TeamThreadMessage[]>(
    eventScopedCacheKey('team-thread', teamConversationId ?? 'none'),
    (sb) =>
      teamConversationId
        ? getTeamMessagesFromClient(sb, teamConversationId)
        : Promise.resolve([]),
  );
  useForegroundPoll(refresh, MESSAGES_POLL_MS);

  // Envío al chat de equipo: insert como el usuario (RLS) + fan-out en el endpoint.
  // Tras el ok, refresco inmediato (el polling lo confirmaría). Sin cola diferida.
  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      if (!teamConversationId) return false;
      try {
        const res = await callServerEndpoint('/api/messages/send', {
          method: 'POST',
          body: { kind: 'team', teamConversationId, body: text, locale: appLocale() },
        });
        if (!res.ok) return false;
        refresh();
        return true;
      } catch {
        return false;
      }
    },
    [teamConversationId, refresh],
  );

  useEffect(() => {
    if (!online || !teamConversationId || !userId) return;
    void markTeamConversationReadFromClient(
      supabase,
      teamConversationId,
      userId,
      new Date().toISOString(),
    );
  }, [online, teamConversationId, userId]);

  if (!teamConversationId) return <EmptyState message={t('mensajes.unavailable')} />;
  if (loading) return <LoadingScreen />;
  const messages = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      {title ? (
        <View className="border-b border-zinc-100 px-4 py-3">
          <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
            {t('mensajes.group_label', { team: title })}
          </Text>
        </View>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState message={t('mensajes.thread_empty')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {messages.map((m) => (
            <TeamBubble
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

function TeamBubble({
  message,
  mine,
  accent,
}: {
  message: TeamThreadMessage;
  mine: boolean;
  accent: string;
}) {
  return (
    <View className={mine ? 'items-end' : 'items-start'}>
      {!mine && message.sender_name ? (
        <Text className="mb-0.5 ml-1 text-[10px] font-semibold text-zinc-500">
          {message.sender_name}
        </Text>
      ) : null}
      <View
        className="max-w-[80%] rounded-2xl px-3 py-2"
        style={mine ? { backgroundColor: accent } : { backgroundColor: '#f4f4f5' }}
      >
        <Text className={mine ? 'text-sm text-white' : 'text-sm text-[#0F1B2E]'}>{message.body}</Text>
      </View>
      <Text className="mt-0.5 text-[10px] text-zinc-400">
        {new Date(message.created_at).toLocaleString()}
      </Text>
    </View>
  );
}
