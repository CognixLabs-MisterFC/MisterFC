import { useLocalSearchParams } from 'expo-router';
import { SesionDetalleScreen } from '@/screens/family/sesion-detalle';

/** O2-5 D1 — detalle de lectura de una sesión (sessionId por navegación). */
export default function Screen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  return <SesionDetalleScreen sessionId={sessionId ?? null} />;
}
