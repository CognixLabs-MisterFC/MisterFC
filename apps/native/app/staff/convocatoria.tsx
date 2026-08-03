import { useLocalSearchParams } from 'expo-router';
import { ConvocatoriaStaffDetalleScreen } from '@/screens/staff/convocatoria-detalle';

/**
 * O2-7b-1 — Detalle de convocatoria del staff (ver respuestas + marcar/desmarcar
 * citados). eventId por navegación desde la lista. Ruta OCULTA (href:null).
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <ConvocatoriaStaffDetalleScreen eventId={eventId ?? null} />;
}
