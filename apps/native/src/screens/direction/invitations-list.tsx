import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import {
  teamScopedCacheKey,
  listTeamInvitationsFromClient,
  type DireccionTeamInvitation,
  type DireccionInvitationStatus,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type T = (key: string, values?: Record<string, string>) => string;
type Filter = 'all' | DireccionInvitationStatus;

const FILTERS: Filter[] = ['all', 'pending', 'expired', 'accepted'];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'dir_inicio.inv_tab_all',
  pending: 'dir_inicio.inv_tab_pending',
  expired: 'dir_inicio.inv_tab_expired',
  accepted: 'dir_inicio.inv_tab_accepted',
};

/**
 * Fecha (día + mes de CATÁLOGO + año), NUNCA `toLocaleString`/`toLocaleDateString`: la
 * app no usa el idioma del dispositivo (mismo criterio que #506 y la fecha de eventos).
 */
function formatDate(t: T, iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${t(`calendario.date.month.${d.getMonth()}`)} ${d.getFullYear()}`;
}

/**
 * Prefijo de la fecha relevante según estado; lleva además el ESTADO (no se repite en
 * otra línea): "Caduca" (pendiente, vigente), "Caducada" (ya vencida), "Aceptada".
 */
function datePrefixKey(status: DireccionInvitationStatus): string {
  if (status === 'accepted') return 'dir_inicio.date_accepted';
  if (status === 'expired') return 'dir_inicio.date_expired';
  return 'dir_inicio.expires';
}

/**
 * D2-3 nivel 2 — Listado individual de las invitaciones de UN equipo (o de las que NO
 * van atadas a equipo) para dirección (SOLO CONSULTA, club-wide). Muestra TODAS con su
 * estado (no solo las pendientes) y un filtro de 4 pestañas
 * (TODAS/PENDIENTES/CADUCADAS/ACEPTADAS) que se aplica en cliente. Cada fila: a quién,
 * rol, estado y la fecha relevante (caducidad si pendiente/caducada, aceptación si
 * aceptada). Filas NO pulsables: una invitación no tiene detalle. RLS
 * `invitations_select_admin_or_invited` da al director todas las del club.
 */
export function DireccionTeamInvitationsScreen({
  teamId,
  teamName,
}: {
  /** Id del equipo, o null para el grupo "Sin equipo" (invitaciones sin `team_id`). */
  teamId: string | null;
  /** Nombre a pintar en la cabecera; null → "Sin equipo". */
  teamName: string | null;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [filter, setFilter] = useState<Filter>('all');

  const { data, fromCache, loading } = useCached<DireccionTeamInvitation[]>(
    teamScopedCacheKey('dir-pend-invite-team', clubId ?? 'none', teamId ?? 'none'),
    (sb) =>
      clubId ? listTeamInvitationsFromClient(sb, clubId, teamId) : Promise.resolve([]),
  );

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={shown}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <ScreenTitle>{teamName ?? t('dir_inicio.no_team')}</ScreenTitle>
            <View className="flex-row flex-wrap gap-2">
              {FILTERS.map((f) => (
                <FilterChip
                  key={f}
                  label={t(FILTER_LABEL[f])}
                  on={filter === f}
                  accent={accent}
                  onPress={() => setFilter(f)}
                />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState message={t('dir_inicio.list_empty')} />}
        renderItem={({ item }) => (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
              {item.email}
            </Text>
            <Text className="mt-1 text-xs text-zinc-500" numberOfLines={1}>
              {t(`roles.${item.role}`)}
            </Text>
            <Text className="text-xs text-zinc-400">
              {`${t(datePrefixKey(item.status))} · ${formatDate(t, item.date)}`}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function FilterChip({
  label,
  on,
  accent,
  onPress,
}: {
  label: string;
  on: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>
        {label}
      </Text>
    </Pressable>
  );
}
