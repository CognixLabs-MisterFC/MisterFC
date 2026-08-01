import { useLocalSearchParams } from 'expo-router';
import { AsistenciaSesionScreen } from '@/screens/staff/asistencia-sesion';

/**
 * O2-7a — Ruta OCULTA (href:null): marcado de una sesión. Se alcanza desde la lista
 * de asistencia con `?eventId`. El equipo lo fija el evento.
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <AsistenciaSesionScreen eventId={eventId ?? null} />;
}
