import { useLocalSearchParams } from 'expo-router';
import { ConvocatoriaDetalleScreen } from '@/screens/family/convocatoria-detalle';

/** O2-5 E1 — detalle de convocatoria + responder (eventId por navegación). */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <ConvocatoriaDetalleScreen eventId={eventId ?? null} />;
}
