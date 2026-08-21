import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getClubPlayersFromClient,
  clubScopedCacheKey,
  formatPlayerName,
  type ClubPlayerRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { ListCard } from '@/screens/staff/hub-parts';
import { DirectoryFilters, foldForSearch, type FilterTeam } from '@/ui/directory-filters';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — JUGADORES de DIRECCIÓN (lista CLUB-WIDE, SOLO LECTURA). Enumera todos
 * los jugadores club-activos (no suprimidos, no bajas) vía `getClubPlayersFromClient`
 * (lectura NUEVA de core, club-wide — no el motor filtrado/paginado de la web).
 * Al tocar uno se abre su ficha en lectura (`/direction/jugador?playerId`). NADA de
 * crear/editar (es web). Candado = AreaGuard('direction'); caché club-scoped.
 *
 * D4 — con 300+ jugadores la lista es inmanejable: se añade BÚSQUEDA por nombre y
 * FILTRO por UN equipo (o "todos"). El filtrado es en CLIENTE porque la lista YA se
 * trae entera (una sola lectura club-wide, sin paginación) y 300 filas se filtran de
 * sobra en memoria; con volúmenes mayores habría que paginar en servidor. Criterio
 * de búsqueda basado en la web (jugadores/queries.ts): coincide en NOMBRE o APELLIDO,
 * sin distinguir mayúsculas; orden apellido→nombre (el que ya trae la lectura de
 * core). A DIFERENCIA de la web, es INSENSIBLE A ACENTOS: `foldForSearch` normaliza
 * el término Y el texto, así "jose" encuentra "José" (en móvil y con nombres
 * españoles, buscar con tildes es casi inútil). El `ilike` de la web tiene el mismo
 * problema y queda señalado en `foldForSearch` (no se toca la web ahora). Los equipos
 * del filtro son los de la temporada ACTIVA: se derivan de la pertenencia abierta
 * (`currentTeamId`, la misma señal que #477/#471), sin consulta extra.
 */
function matchesSearch(p: ClubPlayerRow, foldedTerm: string): boolean {
  if (foldedTerm.length === 0) return true;
  return (
    foldForSearch(p.firstName).includes(foldedTerm) ||
    foldForSearch(p.lastName).includes(foldedTerm)
  );
}

/** Equipos (temporada activa) presentes entre los jugadores, para el selector. */
function teamsOf(players: ClubPlayerRow[]): FilterTeam[] {
  const byId = new Map<string, FilterTeam>();
  for (const p of players) {
    if (p.currentTeamId && !byId.has(p.currentTeamId)) {
      byId.set(p.currentTeamId, {
        id: p.currentTeamId,
        name: p.currentTeamName ?? '',
        color: p.currentTeamColor,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );
}

export function DireccionJugadoresScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [search, setSearch] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<ClubPlayerRow[]>(
    clubScopedCacheKey('dir-jugadores', clubId ?? 'none'),
    (sb) => (clubId ? getClubPlayersFromClient(sb, clubId) : Promise.resolve([])),
  );

  // Referencia estable (no un `data ?? []` nuevo cada render) para que no cambie las
  // dependencias de los useMemo de abajo (react-hooks/exhaustive-deps).
  const players = useMemo(() => data ?? [], [data]);
  const teams = useMemo(() => teamsOf(players), [players]);
  const filtered = useMemo(() => {
    const term = foldForSearch(search.trim());
    return players.filter(
      (p) => (teamId == null || p.currentTeamId === teamId) && matchesSearch(p, term),
    );
  }, [players, search, teamId]);

  if (loading) return <LoadingScreen />;

  const hasFilters = search.trim().length > 0 || teamId != null;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('dir_jugadores.title')}</ScreenTitle>

        {/* D4 — búsqueda por nombre + filtro por equipo (temporada activa). */}
        <DirectoryFilters
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t('jugadores.filters.search_placeholder')}
          teamLabel={t('jugadores.filters.team')}
          teams={teams}
          selectedTeamId={teamId}
          onSelectTeam={setTeamId}
        />

        {filtered.length === 0 ? (
          <EmptyState
            message={hasFilters ? t('jugadores.empty_filtered') : t('dir_jugadores.empty')}
          />
        ) : (
          filtered.map((p) => (
            <ListCard
              key={p.id}
              accent={p.currentTeamColor || accent}
              onPress={() =>
                router.push({
                  pathname: '/direction/jugador',
                  params: { playerId: p.id, name: formatPlayerName(p.firstName, p.lastName) },
                })
              }
            >
              <View className="flex-row items-center gap-3">
                <Text className="w-7 text-right text-sm font-bold text-zinc-400 tabular-nums">
                  {p.dorsal ?? '—'}
                </Text>
                <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {formatPlayerName(p.firstName, p.lastName)}
                </Text>
              </View>
              <Text className="mt-0.5 pl-10 text-xs text-zinc-400" numberOfLines={1}>
                {p.currentTeamName ?? t('jugadores.no_team')}
                {p.positionMain ? ` · ${t(`jugadores.positions.${p.positionMain}`)}` : ''}
              </Text>
            </ListCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
