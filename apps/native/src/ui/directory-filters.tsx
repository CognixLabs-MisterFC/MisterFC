import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '@/auth/context';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

export type FilterTeam = { id: string; name: string; color: string | null };

/**
 * Normaliza texto para BÚSQUEDA: minúsculas + SIN acentos (NFD y elimina los
 * diacríticos combinantes U+0300–U+036F). Debe aplicarse tanto al término buscado
 * como al texto sobre el que se busca, para que la coincidencia valga en ambos
 * sentidos: "jose" encuentra "José" y "José" encuentra "jose". En un móvil (y en un
 * club español, donde media plantilla lleva tildes) una búsqueda sensible a acentos
 * es casi inútil. Mismo patrón anti-acentos que ya usa el core (utils/slug,
 * import/validate).
 *
 * NOTA: la WEB tiene el MISMO problema — su búsqueda usa `ilike` sobre first_name/
 * last_name / full_name (jugadores/queries.ts, cuerpo-tecnico/queries.ts), que es
 * sensible a acentos (no hay `unaccent`). Queda SEÑALADO; no se toca aquí.
 */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * O2 D4/D5 — Barra de acotado para las listas CLUB-WIDE de dirección (jugadores y
 * cuerpo técnico), inmanejables con 300+ filas: BÚSQUEDA por nombre + FILTRO por UN
 * equipo (o "todos"). El filtrado es en CLIENTE (las listas ya se traen enteras).
 * Dos formas de acotar independientes (búsqueda O equipo); combinarlas es trivial
 * (búsqueda dentro del equipo filtrado) y se hace en el llamador.
 *
 * Lenguaje visual del resto de la app: input estilo picker de ejercicios; selector
 * de equipo modal estilo `StaffTeamSelector` (punto de color + ✓). i18n reutiliza
 * las claves de la web (jugadores/cuerpo_tecnico.filters.* + home.direccion.filters).
 */
export function DirectoryFilters({
  search,
  onSearch,
  searchPlaceholder,
  teamLabel,
  teams,
  selectedTeamId,
  onSelectTeam,
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  teamLabel: string;
  teams: FilterTeam[];
  selectedTeamId: string | null;
  onSelectTeam: (id: string | null) => void;
}) {
  const t = useTranslations('');
  const { theme } = useApp();
  const accent = theme?.color ?? BRAND.navy;
  const [open, setOpen] = useState(false);
  const allLabel = t('home.direccion.filters.all_teams');
  const selected = selectedTeamId ? teams.find((tm) => tm.id === selectedTeamId) ?? null : null;

  return (
    <View className="gap-2">
      <TextInput
        value={search}
        onChangeText={onSearch}
        placeholder={searchPlaceholder}
        placeholderTextColor="#a1a1aa"
        autoCorrect={false}
        className="rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
      />

      {/* Filtro por equipo: solo si hay equipos entre los que elegir. */}
      {teams.length > 0 ? (
        <Pressable
          onPress={() => setOpen(true)}
          className="flex-row items-center justify-between rounded-2xl border border-zinc-200 px-3 py-2 active:opacity-70"
        >
          <View className="flex-row items-center gap-2">
            {selected ? (
              <View
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: selected.color || accent }}
              />
            ) : null}
            <Text className="text-sm text-[#0F1B2E]">{selected?.name ?? allLabel}</Text>
          </View>
          <Text className="text-xs text-zinc-400">{teamLabel}</Text>
        </Pressable>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <View className="rounded-t-3xl bg-white p-4 pb-8">
            <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {teamLabel}
            </Text>
            <TeamRow
              label={allLabel}
              active={selectedTeamId == null}
              accent={accent}
              onPress={() => {
                setOpen(false);
                onSelectTeam(null);
              }}
            />
            {teams.map((tm) => (
              <TeamRow
                key={tm.id}
                label={tm.name}
                dotColor={tm.color || accent}
                active={tm.id === selectedTeamId}
                accent={accent}
                onPress={() => {
                  setOpen(false);
                  onSelectTeam(tm.id);
                }}
              />
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function TeamRow({
  label,
  dotColor,
  active,
  accent,
  onPress,
}: {
  label: string;
  /** Color del punto; sin él (opción "todos") no se pinta punto. */
  dotColor?: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between rounded-xl px-3 py-3 active:bg-zinc-50"
    >
      <View className="flex-row items-center gap-2">
        {dotColor ? (
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: dotColor }} />
        ) : null}
        <Text className={active ? 'text-base font-semibold text-[#0F1B2E]' : 'text-base text-zinc-600'}>
          {label}
        </Text>
      </View>
      {active ? <Text style={{ color: accent }}>✓</Text> : null}
    </Pressable>
  );
}
