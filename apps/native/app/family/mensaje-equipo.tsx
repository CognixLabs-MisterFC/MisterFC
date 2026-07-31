import { useLocalSearchParams } from 'expo-router';
import { MensajeEquipoScreen } from '@/screens/family/mensaje-equipo';

/** O2-5 E2a — hilo de equipo (teamConversationId por navegación). */
export default function Screen() {
  const { teamConversationId, title } = useLocalSearchParams<{
    teamConversationId?: string;
    title?: string;
  }>();
  return (
    <MensajeEquipoScreen
      teamConversationId={teamConversationId ?? null}
      title={title ?? null}
    />
  );
}
