import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CalendarioScreen } from '@/screens/family/calendario';
import { CalendarTemporadaScreen } from '@/screens/family/calendario-temporada';
import { useApp } from '@/auth/context';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type Tab = 'upcoming' | 'season';

/**
 * 18-F1 — Calendario de FAMILIA con DOS pestañas. Shell EXCLUSIVO de familia: staff y
 * dirección siguen montando `CalendarioScreen` directamente (comportamiento intacto).
 *  · "Próximos eventos" (por defecto, para no cambiar lo que se ve hoy al entrar) =
 *    `CalendarioScreen` tal cual (agenda actual).
 *  · "Temporada" = vista de MES (18-F1). La vista DÍA llega en F2.
 */
export default function Screen() {
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
        {tab === 'upcoming' ? <CalendarioScreen /> : <CalendarTemporadaScreen />}
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
