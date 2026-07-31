import { useLocalSearchParams } from 'expo-router';
import { EstadisticasScreen } from '@/screens/family/estadisticas';

/** O2-5 E1 — fila del hijo activo en las stats del partido (eventId por navegación). */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <EstadisticasScreen eventId={eventId ?? null} />;
}
