import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/auth/context';
import { EmptyState, ScreenTitle } from '@/ui/feedback';
import { Tile } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * D1b-1 — Detalle de un equipo para DIRECCIÓN (hub, SOLO CONSULTA). Cabecera del
 * equipo + accesos a las secciones read-only, cada una en su ruta /direction con el
 * mismo teamId (reutilizan pantallas ya existentes de familia/staff). En esta entrega:
 * Plantilla, Cuerpo técnico, Estadísticas (D1b-1) y Convocatorias (D1b-2). Las
 * secciones que aún no existen (sesiones, calendario) NO se muestran: llegan en
 * D1b-3/4. Todo bajo AreaGuard('direction'); ni un botón de actuar.
 */
export function DireccionEquipoDetalleScreen({
  teamId,
  name,
  color,
}: {
  teamId: string | null;
  name: string | null;
  color: string | null;
}) {
  const t = useTranslations('');
  const { theme } = useApp();
  const router = useRouter();
  const accent = color || theme?.color || BRAND.navy;

  if (!teamId) return <EmptyState message={t('equipo_detalle.pick_team')} />;

  const go = (pathname: string) =>
    router.push({ pathname, params: { teamId, name: name ?? '', color: accent } });

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{name ?? t('equipo_detalle.title')}</ScreenTitle>
        <View className="flex-row flex-wrap gap-2">
          <Tile
            icon="👥"
            label={t('equipo_detalle.roster')}
            accent={accent}
            onPress={() => go('/direction/equipo-plantilla')}
          />
          <Tile
            icon="👔"
            label={t('equipo_detalle.staff')}
            accent={accent}
            onPress={() => go('/direction/equipo-cuerpo-tecnico')}
          />
          <Tile
            icon="📊"
            label={t('equipo_detalle.stats')}
            accent={accent}
            onPress={() => go('/direction/equipo-estadisticas')}
          />
          <Tile
            icon="📋"
            label={t('convocatorias_staff.title')}
            accent={accent}
            onPress={() => go('/direction/convocatorias')}
          />
        </View>
      </ScrollView>
    </View>
  );
}
