import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getWeekMatchesFromClient,
  getFollowableTeamsFromClient,
  setTeamFollowFromClient,
  matchPhase,
  clubScopedCacheKey,
  type WeekMatch,
  type FollowableTeam,
  type MatchPhaseKind,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Polling de marcadores en vivo (ms). Online refresca en vivo; offline sirve caché. */
const LIVE_POLL_MS = 15_000;

/**
 * O2 Bloque F — Directos: LISTADO de la semana (con polling en vivo cuando hay red;
 * offline muestra el último listado conocido, marcado "sin conexión") + SEGUIR
 * equipos (toggle con write-guard: sin red, deshabilitado).
 *
 * COMPARTIDO entre el área de familia y la de staff: la lista y el "seguir" son
 * CLUB-WIDE (mismos loaders `getWeekMatches`/`getFollowableTeams`, misma tabla
 * `team_follows` por perfil), así que ambas áreas ven lo mismo. Lo ÚNICO que
 * cambia por área es la ruta del DETALLE al tocar un partido (`detailPathname`:
 * `/family/directo` o `/staff/directo`, ambas con `?eventId`). La caché es
 * club-scoped (misma clave = mismos datos), independiente del área.
 */
export function DirectosListScreen({ detailPathname }: { detailPathname: string }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const [tab, setTab] = useState<'live' | 'follow'>('live');

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row border-b border-zinc-100">
        <TabButton label={t('directos.tab_live')} active={tab === 'live'} onPress={() => setTab('live')} />
        <TabButton label={t('directos.follow.follow')} active={tab === 'follow'} onPress={() => setTab('follow')} />
      </View>
      {tab === 'live' ? (
        <LiveList clubId={clubId} detailPathname={detailPathname} />
      ) : (
        <FollowList clubId={clubId} />
      )}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center py-3 active:opacity-70">
      <Text className={active ? 'text-sm font-semibold text-[#0F1B2E]' : 'text-sm text-zinc-400'}>
        {label}
      </Text>
      {active ? <View className="mt-2 h-0.5 w-10 rounded-full bg-[#0F1B2E]" /> : null}
    </Pressable>
  );
}

function LiveList({ clubId, detailPathname }: { clubId: string | null; detailPathname: string }) {
  const t = useTranslations('');
  const { data, fromCache, loading, refresh } = useCached<WeekMatch[]>(
    clubScopedCacheKey('directos', clubId ?? 'none'),
    (sb) => (clubId ? getWeekMatchesFromClient(sb, clubId) : Promise.resolve([])),
  );

  // Polling: online → refetch en vivo (y cachea el último estado); offline → el
  // fetchCached devuelve caché. Un marcador que cambia no se sirve stale online.
  useEffect(() => {
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('directos.empty_live')} />;

  return (
    <View className="flex-1">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={rows}
        keyExtractor={(m) => m.eventId}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) => <MatchCard match={item} detailPathname={detailPathname} />}
      />
    </View>
  );
}

/** Fases EN JUEGO (el reloj corre): se muestra el minuto. El resto → etiqueta de fase. */
const INPLAY_PHASES: ReadonlySet<MatchPhaseKind> = new Set([
  'first_half',
  'second_half',
  'extra_time',
]);

/** "Ahora" que tickea cada segundo solo con un partido en vivo (patrón del detalle);
 *  evita `Date.now()` en render (regla de pureza del React Compiler). */
function useTickingNow(active: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function MatchCard({ match, detailPathname }: { match: WeekMatch; detailPathname: string }) {
  const t = useTranslations('');
  const router = useRouter();
  const live = match.status === 'live';
  const now = useTickingNow(live);
  const statusLabel =
    match.status === 'live'
      ? t('directos.status_live')
      : match.status === 'closed'
        ? t('directos.status_closed')
        : t('directos.status_scheduled');
  // E4 (decisión de Jose) — SIEMPRE día + hora (dd/mm/aaaa hh:mm), pase lo que pase
  // con el marcador: el marcador ya NO sustituye a la fecha.
  const kickoff = new Date(match.startsAt).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const scoreText =
    match.goalsOwn != null ? `${match.goalsOwn} - ${match.goalsRival}` : null;
  // Minuto SOLO si está EN JUEGO (reloj corriendo); en pausa/descanso, la fase.
  const mp = live
    ? matchPhase({
        status: 'live',
        periods: match.periods,
        halfDurationMinutes: match.halfDurationMinutes,
        nowMs: now,
      })
    : null;
  const minuteText = mp
    ? INPLAY_PHASES.has(mp.phase)
      ? mp.addedTime > 0
        ? t('directo.minute_added', { minute: String(mp.minute), added: String(mp.addedTime) })
        : t('directo.minute', { minute: String(mp.minute) })
      : t(`directo.phase.${mp.phase}`)
    : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: detailPathname, params: { eventId: match.eventId } })}
      className="mx-4 my-1.5 rounded-2xl border border-zinc-200 p-4 active:bg-zinc-50"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: match.teamColor || BRAND.navy }} />
          <Text className="text-xs text-zinc-400">{match.categoryName}</Text>
        </View>
        <Text className={`text-xs font-semibold ${match.status === 'live' ? 'text-red-500' : 'text-zinc-400'}`}>
          {statusLabel}
        </Text>
      </View>
      <View className="mt-2 flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {match.teamName}
          {match.opponentName ? `  ${t('common.vs')}  ${match.opponentName}` : ''}
        </Text>
        {scoreText ? (
          <Text className="text-lg font-bold text-[#0F1B2E]">{scoreText}</Text>
        ) : null}
      </View>
      {/* SIEMPRE la fecha; si está en juego, además el minuto/fase. */}
      <View className="mt-1 flex-row items-center justify-between gap-2">
        <Text className="text-xs text-zinc-400">{kickoff}</Text>
        {minuteText ? (
          <Text className="text-xs font-semibold text-red-500">{minuteText}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function FollowList({ clubId }: { clubId: string | null }) {
  const t = useTranslations('');
  const online = useIsOnline();
  const { data, fromCache, loading, refresh } = useCached<FollowableTeam[]>(
    clubScopedCacheKey('directos-follow', clubId ?? 'none'),
    (sb) => (clubId ? getFollowableTeamsFromClient(sb, clubId) : Promise.resolve([])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const onToggle = useCallback(
    async (team: FollowableTeam) => {
      if (!online) return; // write-guard: sin red no se muta
      setBusy(team.teamId);
      const res = await setTeamFollowFromClient(supabase, team.teamId, !team.following);
      setBusy(null);
      if ('ok' in res) {
        refresh();
        void invalidateAfterWrite('setTeamFollow');
      }
    },
    [online, refresh],
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('directos.empty_follow')} />;

  return (
    <View className="flex-1">
      <OfflineBanner show={fromCache} />
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('directos.offline_write')}</Text>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.teamId}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View className="mx-4 my-1 flex-row items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
            <View className="flex-row items-center gap-2">
              <View className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color || BRAND.navy }} />
              <View>
                <Text className="text-base font-medium text-[#0F1B2E]">{item.name}</Text>
                <Text className="text-xs text-zinc-400">{item.categoryName}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => onToggle(item)}
              disabled={!online || busy === item.teamId}
              className={`rounded-full px-3 py-1.5 ${item.following ? 'bg-[#0F1B2E]' : 'border border-zinc-300'}`}
              style={!online ? { opacity: 0.5 } : undefined}
            >
              <Text className={item.following ? 'text-xs font-medium text-white' : 'text-xs font-medium text-zinc-600'}>
                {item.following ? t('directos.follow.following') : t('directos.follow.follow')}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
