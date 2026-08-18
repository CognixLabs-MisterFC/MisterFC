import { useLocalSearchParams } from 'expo-router';
import { SesionDetalleScreen } from '@/screens/family/sesion-detalle';

/** O2-5 D1 — detalle de lectura de una sesión (sessionId por navegación). */
export default function Screen() {
  const { sessionId, past, attendanceCode } = useLocalSearchParams<{
    sessionId?: string;
    past?: string;
    attendanceCode?: string;
  }>();
  return (
    <SesionDetalleScreen
      sessionId={sessionId ?? null}
      past={past === '1'}
      attendanceCode={attendanceCode || null}
    />
  );
}
