import { useLocalSearchParams } from 'expo-router';
import { SesionDetalleScreen } from '@/screens/family/sesion-detalle';

/**
 * D1b-3 — Visor de sesión para dirección (SOLO LECTURA, `?sessionId`). Reusa la
 * pantalla de familia con `allowUnshared`: el director ve TODAS las sesiones
 * asignadas a un entrenamiento del equipo, compartidas o no (las plantillas de
 * biblioteca siguen fuera). Sin `past`/`attendanceCode`: la asistencia es del
 * jugador, no del director.
 */
export default function Screen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  return <SesionDetalleScreen sessionId={sessionId ?? null} allowUnshared />;
}
