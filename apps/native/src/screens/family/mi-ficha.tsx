import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getPlayerFichaFromClient,
  playerScopedCacheKey,
  type PlayerFicha,
  type Badge,
} from '@misterfc/core';
import { loadFichaBadges } from '@/player-ficha/badges';
import {
  FichaAttendance,
  FichaBadges,
  FichaCareer,
  FichaEvaluations,
  FichaStats,
  SeasonChips,
  identityLine,
} from '@/player-ficha/sections';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { PlayerAvatar } from '@/ui/player-avatar';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-5 C1 — Mi ficha (expediente deportivo del HIJO ACTIVO, SOLO LECTURA):
 * identidad, stats/ratios, asistencia, valoraciones y carrera. Todo el fetch +
 * cálculo viene de core (`getPlayerFichaFromClient`); aquí solo se pinta. Caché
 * PLAYER-SCOPED (ficha.clubId.playerId.season). Foto = iniciales (C2). Badges se
 * evalúan aparte (dependen del roster del equipo).
 */
export function MiFichaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;
  const [season, setSeason] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<PlayerFicha | null>(
    `${playerScopedCacheKey('ficha', clubId ?? 'none', playerId ?? 'none')}.${season ?? 'def'}`,
    (sb) =>
      playerId ? getPlayerFichaFromClient(sb, playerId, { season }) : Promise.resolve(null),
  );

  // Badges (Logros): se calculan CON el roster del equipo (comparativa), igual que
  // la web (getPlayerBadgesFromClient). Son de la temporada ACTIVA (no dependen del
  // selector de temporada), por eso la clave NO lleva season. careerMatches sale de
  // la carrera del jugador (misma fuente que la web). RLS directa (policy compañero
  // de equipo en match_player_stats); si el club no expone valoraciones el core no
  // emite las badges de rating (idéntico a la web).
  const { data: badges } = useCached<Badge[]>(
    playerScopedCacheKey('badges', clubId ?? 'none', playerId ?? 'none'),
    (sb) => loadFichaBadges(sb, playerId, clubId),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('ficha.empty')} />;

  const name = activePlayer?.name ?? '';
  const initials = (data.identity.firstName?.[0] ?? '') + (data.identity.lastName?.[0] ?? '');

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {/* Cabecera de identidad (foto real firmada online; iniciales offline). */}
        <View className="flex-row items-center gap-3">
          <PlayerAvatar path={data.identity.photoPath} initials={initials} accent={accent} size={56} />
          <View className="flex-1">
            <Text className="text-xl font-bold text-[#0F1B2E]" numberOfLines={1}>{name}</Text>
            <Text className="text-xs text-zinc-400">{identityLine(data.identity, t)}</Text>
          </View>
        </View>

        <SeasonChips
          seasons={data.seasons}
          active={data.activeSeason}
          onPick={setSeason}
          accent={accent}
        />

        {/* Logros (badges) — mismos badges/orden/textos que la web (catálogo compartido). */}
        <FichaBadges badges={badges} title={t('badges.title')} t={t} accent={accent} />

        <FichaStats
          stats={data.stats}
          ratios={data.ratios}
          title={`${t('ficha.stats')}${data.activeSeason ? ` · ${data.activeSeason}` : ''}`}
          t={t}
        />

        <FichaAttendance attendance={data.attendance} title={t('ficha.attendance')} t={t} />

        <FichaEvaluations
          evaluations={data.evaluations}
          title={t('mi_ficha.section.evaluations')}
          accent={accent}
        />

        <FichaCareer career={data.career} title={t('ficha.career')} t={t} />
      </ScrollView>
    </View>
  );
}
