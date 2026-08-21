import { useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getPlayerCallupDetailFromClient,
  getSharedLineupForEventFromClient,
  respondCallupFromClient,
  playerEventScopedCacheKey,
  eventScopedCacheKey,
  type PlayerCallupDetail,
  type CallupResponseStatus,
  type CallupSquadPlayer,
  type SharedLineupView,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { SharedLineupCard } from './shared-lineup-card';
import { useTranslations } from '@/locale/provider';
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
  const t = useTranslations('');
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

  // Alineación oficial COMPARTIDA (event-scoped: la misma para ambos hijos, a
  // diferencia del detalle player-scoped de arriba). La RLS solo la devuelve si es
  // oficial y compartida con el equipo. Se pinta el campo+banquillo (J6) SOLO si
  // hay titulares colocados; si no, la vista muestra convocados/no convocados (J5).
  const { data: shared } = useCached<SharedLineupView | null>(
    eventScopedCacheKey('shared-lineup', eventId ?? 'none'),
    (sb) => (eventId ? getSharedLineupForEventFromClient(sb, eventId) : Promise.resolve(null)),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (!eventId) return <EmptyState message={t('convocatorias.unavailable')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('convocatorias.unavailable')} />;

  const child = data.players[0] ?? null;
  const isPast = data.isPast;
  // J6 — solo hay alineación "compartida" que pintar (campo + banquillo) si tiene
  // TITULARES colocados en el campo. Si la oficial existe pero sin colocar, se trata
  // como "sin compartir" (J5): se muestran las listas de convocados/no convocados.
  const sharedField =
    shared && shared.positions.some((p) => p.location === 'field') ? shared : null;

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
      // La convocatoria deja de estar "pendiente": refresca inicio, listas y detalle.
      void invalidateAfterWrite('respondCallup');
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
              {t('convocatorias.detail.citation_title')}
            </Text>
            <InfoRow label={t('convocatorias.meeting_at')} value={data.meeting_at ? new Date(data.meeting_at).toLocaleString() : null} />
            <InfoRow label={t('convocatorias.tournament.field.location')} value={data.meeting_location} />
            <InfoRow label={t('convocatorias.publish.field.meeting_address')} value={data.meeting_address} />
            <InfoRow label={t('convocatorias.detail.citation_transport')} value={data.transport_notes} />
            <InfoRow label={t('convocatorias.notes')} value={data.notes_general} />
          </View>
        ) : (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm text-zinc-500">{t('convocatorias.not_published')}</Text>
          </View>
        )}

        {/* J5/J6 — vista de partido. La lista de NO CONVOCADOS se ve SIEMPRE (con la
            convocatoria publicada). Si el entrenador ha COMPARTIDO la alineación (hay
            titulares colocados en el campo) se muestra el campo + banquillo (J6); si
            NO la ha compartido, se muestra la lista de CONVOCADOS (J5) en vez de una
            media tarjeta de alineación vacía. Convocado = roster − descartados;
            no convocado = descartados (regla canónica del core). */}
        {data.published ? (
          <>
            {sharedField ? (
              <SharedLineupCard data={sharedField} accent={accent} />
            ) : (
              <SquadList
                title={t('convocatorias.family_called_title')}
                players={data.squad.calledUp}
                accent={accent}
              />
            )}
            <SquadList
              title={t('convocatorias.family_not_called_title')}
              players={data.squad.notCalledUp}
              accent={accent}
              muted
            />
          </>
        ) : null}

        {/* Decisión técnica sobre el hijo (si publicada). */}
        {child?.decision ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm font-semibold" style={{ color: child.decision === 'called_up' ? '#166534' : '#991b1b' }}>
              {child.decision === 'called_up'
                ? t('convocatorias.decision.called_up')
                : t('convocatorias.decision_discarded')}
            </Text>
          </View>
        ) : null}

        {/* Responder disponibilidad (por el hijo activo). */}
        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('convocatorias.family_your_response')}
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
                      ? t('convocatorias.response.yes')
                      : s === 'maybe'
                        ? t('convocatorias.resp_maybe')
                        : t('convocatorias.response.no')}
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

/**
 * J5/J6 — lista de squad (convocados o no convocados) como chips con dorsal +
 * nombre. Mismo lenguaje de chips que el banquillo de la web. `muted` = estilo
 * apagado para la lista de no convocados (sin acento del club).
 */
function SquadList({
  title,
  players,
  accent,
  muted = false,
}: {
  title: string;
  players: CallupSquadPlayer[];
  accent: string;
  muted?: boolean;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-zinc-200 p-4">
      <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {`${title} · ${players.length}`}
      </Text>
      {players.length === 0 ? (
        <Text className="text-sm text-zinc-400">—</Text>
      ) : (
        <View className="flex-row flex-wrap gap-1.5">
          {players.map((p) => (
            <View
              key={p.playerId}
              className="flex-row items-center gap-1 rounded-md border border-zinc-200 px-2 py-1"
              style={muted ? undefined : { borderLeftWidth: 3, borderLeftColor: accent }}
            >
              {p.dorsal != null ? (
                <Text className="text-xs font-semibold text-zinc-500 tabular-nums">
                  {`#${p.dorsal}`}
                </Text>
              ) : null}
              <Text className={`text-xs ${muted ? 'text-zinc-500' : 'text-[#0F1B2E]'}`}>
                {p.label}
              </Text>
            </View>
          ))}
        </View>
      )}
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
