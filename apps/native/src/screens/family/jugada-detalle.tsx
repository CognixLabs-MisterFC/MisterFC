import { ScrollView, Pressable, Text, View } from 'react-native';
import {
  getTeamPlayFromClient,
  eventScopedCacheKey,
  type Play,
  type TeamPlay,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { usePlayback, PLAYBACK_SPEEDS } from '@/hooks/use-playback';
import { PlayField } from '@/ui/play-field';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Jugada vacía estable (fallback mientras carga; total=0 → sin animación). */
const EMPTY_PLAY: Play = {
  version: 1,
  field: { kind: 'completo', orientation: 'vertical' },
  frames: [{ elements: [] }],
};

/**
 * O2-5 D2 — Visor READ-ONLY de una jugada (familia): reproduce la animación con
 * `react-native-svg` (PlayField) y el motor rAF `usePlayback` (que llama a
 * `sceneAtTime` de core). Controles: play/pausa, stop, loop, velocidad + barra de
 * progreso. La RLS de team_plays es el gate (no compartida → "no disponible").
 * Caché play-scoped del jsonb (contenido táctico, no dato personal).
 */
export function JugadaDetalleScreen({ playId }: { playId: string | null }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<TeamPlay | null>(
    eventScopedCacheKey('play', playId ?? 'none'),
    (sb) => (clubId && playId ? getTeamPlayFromClient(sb, clubId, playId) : Promise.resolve(null)),
  );

  // Hooks SIEMPRE antes de cualquier early return: la jugada real entra cuando
  // carga; usePlayback recomputa total/escena desde el `play` de cada render.
  const play = data?.play ?? EMPTY_PLAY;
  const pb = usePlayback(play);

  if (!playId) return <EmptyState message={t('playbook.unavailable')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('playbook.unavailable')} />;

  const pct = pb.total > 0 ? Math.min(100, (pb.t / pb.total) * 100) : 0;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{data.name ?? t('playbook.untitled')}</Text>

        <PlayField scene={pb.scene} />

        {pb.canAnimate ? (
          <View className="gap-3">
            {/* Barra de progreso (no interactiva). */}
            <View className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: accent }} />
            </View>

            {/* Transporte. */}
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={pb.toggle}
                className="rounded-full px-5 py-2 active:opacity-80"
                style={{ backgroundColor: accent }}
              >
                <Text className="text-sm font-semibold text-white">
                  {pb.playing ? t('playbook.pause') : t('playbook.play')}
                </Text>
              </Pressable>
              <Pressable onPress={pb.stop} className="rounded-full border border-zinc-300 px-4 py-2 active:opacity-60">
                <Text className="text-sm font-medium text-[#0F1B2E]">{t('playbook.stop')}</Text>
              </Pressable>
              <Pressable
                onPress={() => pb.setLoop(!pb.loop)}
                className="rounded-full px-4 py-2 active:opacity-60"
                style={pb.loop ? { backgroundColor: accent } : { borderWidth: 1, borderColor: '#d4d4d8' }}
              >
                <Text className={pb.loop ? 'text-sm font-medium text-white' : 'text-sm font-medium text-[#0F1B2E]'}>
                  {t('playbook.loop')}
                </Text>
              </Pressable>
            </View>

            {/* Velocidad. */}
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-zinc-400">{t('playbook.speed')}</Text>
              {PLAYBACK_SPEEDS.map((s) => {
                const on = pb.speed === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => pb.setSpeed(s)}
                    className="rounded-full px-3 py-1 active:opacity-60"
                    style={on ? { backgroundColor: accent } : { borderWidth: 1, borderColor: '#d4d4d8' }}
                  >
                    <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>{`${s}×`}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text className="text-center text-xs text-zinc-400">{t('playbook.single_frame')}</Text>
        )}
      </ScrollView>
    </View>
  );
}
