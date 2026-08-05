import { useLocalSearchParams } from 'expo-router';
import { MensajeEquipoScreen } from '@/screens/family/mensaje-equipo';

/** O2-11a-1 — hilo de equipo de dirección (?teamConversationId). Pantalla generica. */
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
