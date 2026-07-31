import { useLocalSearchParams } from 'expo-router';
import { JugadaDetalleScreen } from '@/screens/family/jugada-detalle';

/** O2-5 D2 — visor animado de una jugada (playId por navegación). */
export default function Screen() {
  const { playId } = useLocalSearchParams<{ playId?: string }>();
  return <JugadaDetalleScreen playId={playId ?? null} />;
}
