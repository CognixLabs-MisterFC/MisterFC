import { useLocalSearchParams } from 'expo-router';
import { CargaActaScreen } from '@/screens/staff/carga-acta';

/** Carga manual del acta: meter el partido entero de corrido, al acabar. */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <CargaActaScreen eventId={eventId ?? null} />;
}
