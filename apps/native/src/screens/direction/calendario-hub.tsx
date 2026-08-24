import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useApp } from '@/auth/context';
import { useTranslations } from '@/locale/provider';
import { ScreenTitle } from '@/ui/feedback';
import { BRAND } from '@/theme';

/**
 * 18-F3c — LANZADERA del calendario de DIRECCIÓN. Es el destino único de la palabra
 * "Calendario" (pestaña de barra Y entrada de menú). Tres tarjetas, NINGUNA abierta por
 * defecto; cada una empuja a su ruta dedicada (así no hay pestañas dentro de pestañas):
 *  · Próximos eventos → agenda club-wide.
 *  · Temporada        → MES/DÍA club-wide, con filtro de equipos.
 *  · Festivos         → DireccionCalendarioScreen (marcar/aprobar), intacta.
 * La flecha ‹ del header devuelve aquí (rutas hijas no son pestaña raíz).
 */
export function DireccionCalendarioHubScreen() {
  const t = useTranslations('');
  const { theme } = useApp();
  const router = useRouter();
  const accent = theme?.color ?? BRAND.navy;

  const cards = [
    {
      key: 'upcoming',
      icon: '📅',
      title: t('calendario.tabs.upcoming'),
      desc: t('calendario.direction.upcoming_desc'),
      href: '/direction/calendario-proximos',
    },
    {
      key: 'season',
      icon: '🗓️',
      title: t('calendario.tabs.season'),
      desc: t('calendario.direction.season_desc'),
      href: '/direction/calendario-temporada',
    },
    {
      key: 'holidays',
      icon: '🎌',
      title: t('calendario.direction.holidays'),
      desc: t('calendario.direction.holidays_desc'),
      href: '/direction/calendario-festivos',
    },
  ] as const;

  return (
    <View className="flex-1 bg-white">
      <ScreenTitle>{t('calendario.title')}</ScreenTitle>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {cards.map((card) => (
          <Pressable
            key={card.key}
            onPress={() => router.push(card.href as Href)}
            className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 p-4 active:opacity-70"
            style={{ borderLeftWidth: 4, borderLeftColor: accent }}
          >
            <Text className="text-3xl">{card.icon}</Text>
            <View className="flex-1">
              <Text className="text-base font-bold text-[#0F1B2E]">{card.title}</Text>
              <Text className="mt-0.5 text-sm text-zinc-500">{card.desc}</Text>
            </View>
            <Text className="text-2xl text-zinc-300">›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
