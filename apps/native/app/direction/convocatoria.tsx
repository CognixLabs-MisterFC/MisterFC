import { useLocalSearchParams } from 'expo-router';
import { ConvocatoriaStaffDetalleScreen } from '@/screens/staff/convocatoria-detalle';

/**
 * D1b-2 — Detalle de convocatoria para dirección (SOLO LECTURA, `?eventId`). Reusa la
 * pantalla de staff con `readOnly`: oculta toda la barra de acciones y muestra
 * cabecera + respuestas + convocados/no-convocados + alineación oficial compartida.
 * Para actuar sobre la convocatoria (convocar, publicar, editar alineación, directo)
 * se usa la web.
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <ConvocatoriaStaffDetalleScreen eventId={eventId ?? null} readOnly />;
}
