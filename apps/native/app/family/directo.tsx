import { useLocalSearchParams } from 'expo-router';
import { DirectoDetalleScreen } from '@/screens/family/directo-detalle';

/** O2-5 B2 — detalle de un directo. `eventId` llega por query (card del listado). */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <DirectoDetalleScreen eventId={eventId ?? null} />;
}
