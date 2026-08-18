import { useLocalSearchParams } from 'expo-router';
import { EntrenamientoDetalleScreen } from '@/screens/family/entrenamiento-detalle';

/** O2 — Detalle de un entrenamiento sin sesión (datos por navegación desde la lista). */
export default function Screen() {
  const { title, startsAt, locationName, past, attendanceCode } =
    useLocalSearchParams<{
      title?: string;
      startsAt?: string;
      locationName?: string;
      past?: string;
      attendanceCode?: string;
    }>();
  return (
    <EntrenamientoDetalleScreen
      title={title ?? null}
      startsAt={startsAt ?? null}
      locationName={locationName || null}
      past={past === '1'}
      attendanceCode={attendanceCode || null}
    />
  );
}
