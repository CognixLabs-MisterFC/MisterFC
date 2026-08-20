import { useLocalSearchParams } from 'expo-router';
import { SesionEditarScreen } from '@/screens/staff/sesion-editar';

/**
 * G1 — Ruta OCULTA (href:null): editor de sesión de entrenamiento del staff. Se
 * alcanza desde el detalle del entrenamiento (asistencia-sesion) con `?sessionId`.
 */
export default function Screen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  return <SesionEditarScreen sessionId={sessionId ?? null} />;
}
