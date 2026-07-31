import { useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getPlayerCallupDetailFromClient,
  respondCallupFromClient,
  playerEventScopedCacheKey,
  type PlayerCallupDetail,
  type CallupResponseStatus,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-5 E1 — Detalle de convocatoria del HIJO ACTIVO + RESPONDER disponibilidad
 * (única escritura de peso de familia en E1). El fetch (lean, player-scoped) y la
 * escritura (upsert con responded_by=auth.uid; gate tutor→hijo por RLS) viven en
 * core. La respuesta se da POR EL HIJO ACTIVO: para responder por otro hijo, se
 * cambia de hijo en el selector. Write-guard: sin red, botones deshabilitados.
 * Caché player+event-scoped (dos hermanos ven el mismo evento con datos distintos).
 */
export function ConvocatoriaDetalleScreen({ eventId }: { eventId: string | null }) {
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const router = useRouter();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'forbidden' | 'error'>('idle');

  // `isPast` se computa en el fetcher (no en render) para no llamar a Date.now()
  // durante el render (regla react-hooks/purity de React Compiler).
  const { data, fromCache, loading, refresh } = useCached<
    (PlayerCallupDetail & { isPast: boolean }) | null
  >(
    playerEventScopedCacheKey('convocatoria', clubId ?? 'none', playerId ?? 'none', eventId ?? 'none'),
    async (sb) => {
      if (!clubId || !playerId || !eventId) return null;
      const d = await getPlayerCallupDetailFromClient(sb, clubId, eventId, [playerId]);
      if (!d) return null;
      return { ...d, isPast: new Date(d.event.starts_at).getTime() < Date.now() };
    },
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (!eventId) return <EmptyState message={t('convocatorias.unavailable')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('convocatorias.unavailable')} />;

  const child = data.players[0] ?? null;
  const isPast = data.isPast;

  async function respond(status: CallupResponseStatus) {
    if (!online || busy || !eventId || !playerId) return;
    setBusy(true);
    setSaveState('idle');
    const res = await respondCallupFromClient(supabase, {
      event_id: eventId,
      player_id: playerId,
      status,
      reason: null,
    });
    setBusy(false);
    if (res.ok) {
      setSaveState('saved');
      refresh();
    } else if (res.code === '42501' || res.noUser) {
      setSaveState('forbidden');
    } else {
      setSaveState('error');
    }
  }

  const e = data.event;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('convocatorias.detail_title')}</ScreenTitle>

        {/* Cabecera del partido. */}
        <View className="rounded-2xl border border-zinc-200 p-4">
          <View className="flex-row items-center gap-2">
            <View className="h-4 w-4 rounded-full" style={{ backgroundColor: e.team_color }} />
            <Text className="flex-1 text-lg font-bold text-[#0F1B2E]">
              {e.title}
              {e.opponent_name ? ` · ${e.opponent_name}` : ''}
            </Text>
          </View>
          <Text className="mt-1 text-xs text-zinc-400">
            {[new Date(e.starts_at).toLocaleString(), e.team_name, e.category_name].filter(Boolean).join(' · ')}
          </Text>
          {e.location_name ? (
            <Text className="mt-1 text-xs text-zinc-400">📍 {e.location_name}</Text>
          ) : null}
        </View>

        {/* Datos de citación (si publicada). */}
        {data.published ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('convocatorias.meeting')}
            </Text>
            <InfoRow label={t('convocatorias.meeting_at')} value={data.meeting_at ? new Date(data.meeting_at).toLocaleString() : null} />
            <InfoRow label={t('convocatorias.meeting_place')} value={data.meeting_location} />
            <InfoRow label={t('convocatorias.meeting_address')} value={data.meeting_address} />
            <InfoRow label={t('convocatorias.transport')} value={data.transport_notes} />
            <InfoRow label={t('convocatorias.notes')} value={data.notes_general} />
          </View>
        ) : (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm text-zinc-500">{t('convocatorias.not_published')}</Text>
          </View>
        )}

        {/* Decisión técnica sobre el hijo (si publicada). */}
        {child?.decision ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm font-semibold" style={{ color: child.decision === 'called_up' ? '#166534' : '#991b1b' }}>
              {child.decision === 'called_up'
                ? t('convocatorias.decision_called')
                : t('convocatorias.decision_discarded')}
            </Text>
          </View>
        ) : null}

        {/* Responder disponibilidad (por el hijo activo). */}
        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('convocatorias.your_response')}
          </Text>
          <Text className="mb-3 text-xs text-zinc-400">
            {t('convocatorias.response_hint', { name: activePlayer?.name ?? '' })}
          </Text>
          <View className="flex-row gap-2">
            {(['yes', 'maybe', 'no'] as const).map((s) => {
              const on = child?.response === s;
              const bg = s === 'yes' ? '#16a34a' : s === 'no' ? '#dc2626' : '#d97706';
              return (
                <Pressable
                  key={s}
                  onPress={() => respond(s)}
                  disabled={!online || busy}
                  className={`flex-1 items-center rounded-xl py-2 active:opacity-70 ${!online || busy ? 'opacity-40' : ''}`}
                  style={on ? { backgroundColor: bg } : { borderWidth: 1, borderColor: '#e4e4e7' }}
                >
                  <Text className={on ? 'text-sm font-semibold text-white' : 'text-sm text-zinc-600'}>
                    {s === 'yes'
                      ? t('convocatorias.resp_yes')
                      : s === 'maybe'
                        ? t('convocatorias.resp_maybe')
                        : t('convocatorias.resp_no')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!online ? (
            <Text className="mt-2 text-xs text-amber-600">{t('convocatorias.offline_write')}</Text>
          ) : null}
          {saveState === 'saved' ? (
            <Text className="mt-2 text-xs text-emerald-600">{t('convocatorias.saved')}</Text>
          ) : null}
          {saveState === 'forbidden' ? (
            <Text className="mt-2 text-xs text-red-600">{t('convocatorias.forbidden')}</Text>
          ) : null}
          {saveState === 'error' ? (
            <Text className="mt-2 text-xs text-red-600">{t('convocatorias.error')}</Text>
          ) : null}
        </View>

        {/* Estadísticas del partido (si ya se jugó). */}
        {isPast ? (
          <Pressable
            onPress={() => router.push({ pathname: '/family/estadisticas', params: { eventId: e.id } })}
            className="rounded-2xl px-4 py-3 active:opacity-70"
            style={{ backgroundColor: accent }}
          >
            <Text className="text-center text-sm font-semibold text-white">
              {t('convocatorias.view_stats')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View className="mb-1 flex-row justify-between gap-3">
      <Text className="text-xs text-zinc-400">{label}</Text>
      <Text className="flex-1 text-right text-sm text-[#0F1B2E]">{value}</Text>
    </View>
  );
}
