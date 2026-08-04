import { useLocalSearchParams } from 'expo-router';
import { PostMatchScreen } from '@/screens/staff/post-partido';

/**
 * O2-9c — Post-partido (staff): resultado final + valoraciones. eventId por
 * navegación desde el directo (al pitar el final) o desde el detalle. Sin eventId
 * → "elige un partido".
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <PostMatchScreen eventId={eventId ?? null} />;
}
