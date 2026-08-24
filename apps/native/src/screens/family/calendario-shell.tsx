import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CalendarEvent } from '@misterfc/core';
import { CalendarioScreen } from '@/screens/family/calendario';
import { CalendarTemporadaScreen } from '@/screens/family/calendario-temporada';
import { useApp } from '@/auth/context';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { familyEventTarget, type FamilyTarget } from '@/notifications/feed-target';

type Tab = 'upcoming' | 'season';

/**
 * 18-F1/F3a — Shell de calendario con DOS pestañas ("Próximos eventos" = agenda actual;
 * "Temporada" = MES/DÍA). Extraído de la ruta de familia para que STAFF (F3b) y DIRECCIÓN
 * (F3c) lo monten con SUS props sin duplicar el patrón. Abre por defecto en "Próximos
 * eventos" (no cambia lo que se ve hoy al entrar).
 *
 * Props (todas con default de FAMILIA → montado sin props se ve EXACTAMENTE como hoy):
 *  · `eventTarget` → enrutado del tap por área (familia/staff/dirección).
 *  · `teamId`      → acota a un equipo (agenda + temporada), D1b-4.
 *  · `clubWide`    → todos los eventos del club (dirección), sin scope por-usuario.
 *  · `teamFilter`  → filtro de equipos en la pestaña Temporada (solo si >1 equipo).
 */
export function CalendarShell({
  eventTarget = familyEventTarget,
  teamId = null,
  clubWide = false,
  teamFilter = false,
}: {
  eventTarget?: (ev: CalendarEvent) => FamilyTarget;
  teamId?: string | null;
  clubWide?: boolean;
  teamFilter?: boolean;
} = {}) {
  const t = useTranslations('');
  const { theme } = useApp();
  const accent = theme?.color ?? BRAND.navy;
  const [tab, setTab] = useState<Tab>('upcoming');

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row gap-2 px-4 pb-2 pt-3">
        <TabChip
          label={t('calendario.tabs.upcoming')}
          on={tab === 'upcoming'}
          accent={accent}
          onPress={() => setTab('upcoming')}
        />
        <TabChip
          label={t('calendario.tabs.season')}
          on={tab === 'season'}
          accent={accent}
          onPress={() => setTab('season')}
        />
      </View>
      <View className="flex-1">
        {tab === 'upcoming' ? (
          <CalendarioScreen eventTarget={eventTarget} teamId={teamId} clubWide={clubWide} />
        ) : (
          <CalendarTemporadaScreen
            eventTarget={eventTarget}
            teamId={teamId}
            clubWide={clubWide}
            teamFilter={teamFilter}
          />
        )}
      </View>
    </View>
  );
}

function TabChip({
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
