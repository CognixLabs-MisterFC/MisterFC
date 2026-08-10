import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getPlayerSpectatorsFromClient,
  removeSpectatorFromClient,
  playerScopedCacheKey,
  type PlayerSpectator,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { ChildSelector } from '@/ui/child-selector';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { appLocale, useTranslations } from '@/locale/provider';

/**
 * O2-5 C1/F2 — Seguidores del HIJO ACTIVO: listar + revocar + INVITAR. Invitar es
 * server-only por el email (fan-out del envío): la app llama al route handler
 * `/api/spectators/invite` con Bearer (F2), que aplica el gate tutor/self dentro del
 * RPC como el usuario y solo después manda el email con service-role. Write-guard:
 * sin red, invitar/revocar deshabilitados. Caché PLAYER-SCOPED.
 */
export function SeguidoresScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const { activePlayer } = useActivePlayer();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const playerName = activePlayer?.name ?? '';
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data, fromCache, loading, refresh } = useCached<PlayerSpectator[]>(
    playerScopedCacheKey('seguidores', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerSpectatorsFromClient(sb, playerId) : Promise.resolve([])),
  );

  const onRevoke = useCallback(
    async (spectatorProfileId: string) => {
      if (!online || !playerId) return; // write-guard
      setBusy(spectatorProfileId);
      const res = await removeSpectatorFromClient(supabase, playerId, spectatorProfileId);
      setBusy(null);
      if ('ok' in res) refresh();
    },
    [online, playerId, refresh],
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Text className="text-xl font-semibold text-[#0F1B2E]">{t('seguidores.title')}</Text>
        <Pressable
          onPress={() => setInviteOpen(true)}
          disabled={!online}
          className="rounded-full bg-[#0F1B2E] px-3 py-1.5 active:opacity-80"
          style={!online ? { opacity: 0.5 } : undefined}
        >
          <Text className="text-xs font-medium text-white">{t('seguidores.invite.action')}</Text>
        </Pressable>
      </View>
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('seguidores.offline_write')}</Text>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState message={t('seguidores.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.spectator_profile_id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <View className="mx-4 my-1 flex-row items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
              <View className="min-w-0 flex-1 pr-2">
                <Text className="text-base font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {item.full_name?.trim() || item.email || t('seguidores.list.unknown')}
                </Text>
                {item.email ? (
                  <Text className="text-xs text-zinc-400" numberOfLines={1}>{item.email}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => onRevoke(item.spectator_profile_id)}
                disabled={!online || busy === item.spectator_profile_id}
                className="rounded-full border border-red-200 px-3 py-1.5 active:opacity-60"
                style={!online ? { opacity: 0.5 } : undefined}
              >
                <Text className="text-xs font-medium text-red-600">{t('seguidores.revoke.action')}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
      <Text className="px-4 py-3 text-xs text-zinc-400">{t('seguidores.hint')}</Text>

      <InviteModal
        visible={inviteOpen}
        playerId={playerId}
        playerName={playerName}
        online={online}
        onClose={() => setInviteOpen(false)}
      />
    </View>
  );
}

type InviteOutcome = 'ok' | 'existing' | 'forbidden' | 'email_invalid' | 'error';

/**
 * Modal de invitar seguidor. Llama al route handler con Bearer (callServerEndpoint).
 * Éxito (ok/existing) → pantalla de confirmación; el resto → error en línea y reintento.
 */
function InviteModal({
  visible,
  playerId,
  playerName,
  online,
  onClose,
}: {
  visible: boolean;
  playerId: string;
  playerName: string;
  online: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  const close = useCallback(() => {
    if (sending) return;
    setEmail('');
    setOutcome(null);
    onClose();
  }, [sending, onClose]);

  const submit = useCallback(async () => {
    const trimmed = email.trim();
    if (!online || sending || !trimmed) return; // write-guard
    setSending(true);
    setOutcome(null);
    try {
      const res = await callServerEndpoint('/api/spectators/invite', {
        method: 'POST',
        body: { playerId, email: trimmed, locale: appLocale() },
      });
      let json: { status?: string; error?: string } = {};
      try {
        json = (await res.json()) as { status?: string; error?: string };
      } catch {
        json = {};
      }
      if (res.ok) {
        setOutcome(json.status === 'existing' ? 'existing' : 'ok');
      } else if (res.status === 403 || json.error === 'forbidden') {
        setOutcome('forbidden');
      } else if (json.error === 'email_invalid') {
        setOutcome('email_invalid');
      } else {
        setOutcome('error');
      }
    } catch {
      // no_web_url / no_session / red caída
      setOutcome('error');
    } finally {
      setSending(false);
    }
  }, [email, online, sending, playerId]);

  const success = outcome === 'ok' || outcome === 'existing';
  const inlineError =
    outcome === 'forbidden' || outcome === 'email_invalid' || outcome === 'error'
      ? t(`seguidores.invite_${outcome}`)
      : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md rounded-2xl bg-white p-5">
          {success ? (
            <>
              <Text className="text-lg font-bold text-[#0F1B2E]">{t('seguidores.invite.title')}</Text>
              <Text className="mt-2 text-sm text-zinc-700">
                {t(`seguidores.invite_${outcome}`, { email: email.trim() })}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable onPress={close} className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80">
                  <Text className="text-sm font-semibold text-white">{t('seguidores.invite.close')}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="text-lg font-bold text-[#0F1B2E]">{t('seguidores.invite.title')}</Text>
              <Text className="mt-2 text-sm text-zinc-600">
                {t('seguidores.invite_desc', { name: playerName })}
              </Text>
              <Text className="mt-3 text-xs font-medium text-zinc-500">{t('seguidores.invite.field.email')}</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('seguidores.invite_email_ph')}
                placeholderTextColor="#a1a1aa"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={254}
                editable={!sending}
                className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
              />
              {inlineError ? (
                <Text className="mt-2 text-xs text-red-600">{inlineError}</Text>
              ) : null}
              {!online ? (
                <Text className="mt-2 text-xs text-zinc-500">{t('seguidores.invite_offline')}</Text>
              ) : null}
              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable onPress={close} disabled={sending} className="rounded-full px-4 py-2 active:opacity-60">
                  <Text className="text-sm text-zinc-500">{t('seguidores.invite.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={!online || sending || email.trim().length === 0}
                  className="flex-row items-center gap-2 rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                  style={!online || sending || email.trim().length === 0 ? { opacity: 0.5 } : undefined}
                >
                  {sending ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text className="text-sm font-semibold text-white">
                    {sending ? t('seguidores.invite_sending') : t('seguidores.invite.send')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
