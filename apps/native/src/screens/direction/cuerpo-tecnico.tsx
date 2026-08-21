import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getClubStaffFromClient,
  clubScopedCacheKey,
  type ClubStaffRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { ListCard, RoleChip } from '@/screens/staff/hub-parts';
import { DirectoryFilters, foldForSearch, type FilterTeam } from '@/ui/directory-filters';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — CUERPO TÉCNICO de DIRECCIÓN (lista CLUB-WIDE, SOLO LECTURA). Enumera
 * todo el cuerpo técnico del club vía `getClubStaffFromClient` (lectura NUEVA de
 * core, club-wide — no el motor de gestión de la web). Al tocar uno se abre su ficha
 * en lectura (`/direction/coach?membershipId`). NADA de mover staff (es web).
 * Candado = AreaGuard('direction'); caché club-scoped.
 *
 * D5 — con un cuerpo técnico grande la lista es inmanejable: BÚSQUEDA por nombre y
 * FILTRO por UN equipo (o "todos"). Filtrado en CLIENTE (la lista ya se trae entera).
 * Criterio basado en la web (cuerpo-tecnico/queries.ts): la búsqueda coincide en el
 * NOMBRE COMPLETO sin distinguir mayúsculas; el filtro de equipo casa si ALGUNA de
 * sus asignaciones es de ese equipo (`assignments.some`); orden alfabético por nombre
 * (`localeCompare('es', { sensitivity: 'base' })`, insensible a acentos). A DIFERENCIA
 * de la web, la búsqueda es INSENSIBLE A ACENTOS: `foldForSearch` normaliza término y
 * texto → "jose" encuentra "José". El `ilike` de la web tiene el mismo problema y
 * queda señalado en `foldForSearch` (no se toca la web ahora). Los equipos del filtro
 * (temporada activa) se derivan de las asignaciones abiertas, sin consulta extra.
 */
function matchesSearch(c: ClubStaffRow, foldedTerm: string): boolean {
  return foldedTerm.length === 0 || foldForSearch(c.fullName).includes(foldedTerm);
}

/** Equipos presentes entre las asignaciones del cuerpo técnico, para el selector. */
function teamsOf(coaches: ClubStaffRow[]): FilterTeam[] {
  const byId = new Map<string, FilterTeam>();
  for (const c of coaches) {
    for (const a of c.assignments) {
      if (!byId.has(a.teamId)) {
        byId.set(a.teamId, { id: a.teamId, name: a.teamName, color: a.teamColor });
      }
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );
}

export function DireccionCuerpoTecnicoScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [search, setSearch] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<ClubStaffRow[]>(
    clubScopedCacheKey('dir-cuerpo', clubId ?? 'none'),
    (sb) => (clubId ? getClubStaffFromClient(sb, clubId) : Promise.resolve([])),
  );

  // Referencia estable (no un `data ?? []` nuevo cada render) para que no cambie las
  // dependencias de los useMemo de abajo (react-hooks/exhaustive-deps).
  const coaches = useMemo(() => data ?? [], [data]);
  const teams = useMemo(() => teamsOf(coaches), [coaches]);
  const filtered = useMemo(() => {
    const term = foldForSearch(search.trim());
    return coaches
      .filter(
        (c) =>
          (teamId == null || c.assignments.some((a) => a.teamId === teamId)) &&
          matchesSearch(c, term),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));
  }, [coaches, search, teamId]);

  if (loading) return <LoadingScreen />;

  const hasFilters = search.trim().length > 0 || teamId != null;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('dir_cuerpo.title')}</ScreenTitle>

        {/* D5 — búsqueda por nombre + filtro por equipo (temporada activa). */}
        <DirectoryFilters
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t('cuerpo_tecnico.filters.search_placeholder')}
          teamLabel={t('cuerpo_tecnico.filters.team')}
          teams={teams}
          selectedTeamId={teamId}
          onSelectTeam={setTeamId}
        />

        {filtered.length === 0 ? (
          <EmptyState
            message={hasFilters ? t('cuerpo_tecnico.empty_filtered') : t('dir_cuerpo.empty')}
          />
        ) : (
          filtered.map((c) => (
            <ListCard
              key={c.membershipId}
              accent={c.assignments[0]?.teamColor || accent}
              onPress={() =>
                router.push({
                  pathname: '/direction/coach',
                  params: { membershipId: c.membershipId, name: c.fullName },
                })
              }
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-base font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {c.fullName}
                </Text>
                <RoleChip label={t(`club_role.${c.clubRole}`)} />
              </View>
              <Text className="mt-0.5 text-xs text-zinc-400" numberOfLines={1}>
                {c.assignments.map((a) => a.teamName).join(' · ') || t('dir_cuerpo.no_team')}
              </Text>
            </ListCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
