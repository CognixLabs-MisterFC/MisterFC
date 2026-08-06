import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import {
  getPendingErasuresFromClient,
  clubScopedCacheKey,
  type PendingErasure,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';

/**
 * O2-11c-2 — SUPRESIONES RGPD (dirección). La acción MÁS IRREVERSIBLE (borra datos
 * de un menor). GATE admin_club-ONLY (el director ve la lista pero NO los controles;
 * el candado real es el server → 403). Aprobar EXIGE confirmación explícita en DOS
 * pasos (aviso → confirmación destructiva). Aprobar/rechazar van por route handler
 * bearer (aprobar borra storage service-role DESPUÉS de la RPC; rechazar es RPC plana).
 * Offline solo lectura (write-guard). Caché club-scoped.
 */
export function DireccionSupresionesScreen() {
  const { activeClub } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const isAdminClub = activeClub?.role === 'admin_club';

  const { data, fromCache, loading, refresh } = useCached<PendingErasure[]>(
    clubScopedCacheKey('dir-supresiones', clubId ?? 'none'),
    (sb) => (clubId ? getPendingErasuresFromClient(sb, clubId) : Promise.resolve([])),
  );

  const [busy, setBusy] = useState(false);

  const post = async (path: string, requestId: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await callServerEndpoint(path, { body: { requestId } });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        Alert.alert(t('dir_sup.error'), j.error ?? String(r.status));
      } else {
        refresh();
      }
    } catch {
      Alert.alert(t('dir_sup.error'), t('dir_sup.offline'));
    } finally {
      setBusy(false);
    }
  };

  // Aprobar: confirmación EXPLÍCITA en dos pasos (irreversible, datos de un menor).
  const confirmApprove = (item: PendingErasure) => {
    if (!online || busy) return;
    Alert.alert(t('dir_sup.approve_warn_title'), t('dir_sup.approve_warn_body', { name: item.playerName }), [
      { text: t('dir_sup.cancel'), style: 'cancel' },
      {
        text: t('dir_sup.continue'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('dir_sup.approve_final_title'), t('dir_sup.approve_final_body'), [
            { text: t('dir_sup.cancel'), style: 'cancel' },
            {
              text: t('dir_sup.approve_final_btn'),
              style: 'destructive',
              onPress: () => post('/api/erasures/approve', item.id),
            },
          ]),
      },
    ]);
  };

  const confirmReject = (item: PendingErasure) => {
    if (!online || busy) return;
    Alert.alert(t('dir_sup.reject_title'), t('dir_sup.reject_body', { name: item.playerName }), [
      { text: t('dir_sup.cancel'), style: 'cancel' },
      { text: t('dir_sup.reject_btn'), onPress: () => post('/api/erasures/reject', item.id) },
    ]);
  };

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <ScreenTitle>{t('dir_sup.title')}</ScreenTitle>
        <Text className="text-xs text-zinc-400">{t('dir_sup.hint')}</Text>
        {!isAdminClub ? (
          <View className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Text className="text-xs text-amber-700">{t('dir_sup.only_admin')}</Text>
          </View>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState message={t('dir_sup.empty')} />
        ) : (
          rows.map((item) => (
            <View key={item.id} className="rounded-2xl border border-zinc-200 p-4">
              <Text className="text-base font-semibold text-[#0F1B2E]">{item.playerName}</Text>
              <Text className="mt-0.5 text-xs text-zinc-400">
                {t('dir_sup.requested_by', {
                  who: item.requesterName ?? '—',
                  date: new Date(item.requestedAt).toLocaleDateString(),
                })}
              </Text>
              {item.reason ? <Text className="mt-1 text-xs text-zinc-500">“{item.reason}”</Text> : null}

              {isAdminClub ? (
                <View className="mt-3 flex-row gap-2">
                  <Pressable
                    disabled={!online || busy}
                    onPress={() => confirmApprove(item)}
                    className={`rounded-lg px-4 py-1.5 ${!online || busy ? 'opacity-40' : 'active:opacity-70'}`}
                    style={{ backgroundColor: '#dc2626' }}
                  >
                    <Text className="text-xs font-semibold text-white">{t('dir_sup.approve')}</Text>
                  </Pressable>
                  <Pressable
                    disabled={!online || busy}
                    onPress={() => confirmReject(item)}
                    className={`rounded-lg border border-zinc-200 px-4 py-1.5 ${!online || busy ? 'opacity-40' : 'active:opacity-70'}`}
                  >
                    <Text className="text-xs font-semibold text-zinc-600">{t('dir_sup.reject')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
