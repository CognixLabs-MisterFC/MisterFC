import { useLocalSearchParams } from 'expo-router';
import { DirectoControlScreen } from '@/screens/staff/directo';

/**
 * O2-9a — Control del directo (staff): reloj + estado del partido. eventId por
 * navegación desde el detalle de la convocatoria. Sin eventId → "elige un partido".
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <DirectoControlScreen eventId={eventId ?? null} />;
}
