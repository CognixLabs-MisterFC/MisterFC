import { useLocalSearchParams } from 'expo-router';
import { EntrenamientoDetalleScreen } from '@/screens/family/entrenamiento-detalle';

/**
 * D1b-3 — Detalle de un entrenamiento SIN sesión para dirección (SOLO LECTURA). Reusa
 * la pantalla de familia, que es área-neutral (solo datos por navegación, sin fetch,
 * sin router, sin activePlayer). Sin `past`/`attendanceCode` (asistencia = jugador).
 */
export default function Screen() {
  const { title, startsAt, locationName } = useLocalSearchParams<{
    title?: string;
    startsAt?: string;
    locationName?: string;
  }>();
  return (
    <EntrenamientoDetalleScreen
      title={title ?? null}
      startsAt={startsAt ?? null}
      locationName={locationName || null}
    />
  );
}
