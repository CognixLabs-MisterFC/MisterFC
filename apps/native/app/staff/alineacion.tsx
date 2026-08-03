import { useLocalSearchParams } from 'expo-router';
import { AlineacionScreen } from '@/screens/staff/alineacion';

/**
 * O2-8a — Alineación del partido (staff). eventId por navegación desde el detalle de
 * la convocatoria. Sin eventId (abierta desde el menú) → estado "elige un partido".
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <AlineacionScreen eventId={eventId ?? null} />;
}
