import { useLocalSearchParams } from 'expo-router';
import { MensajeEquipoScreen } from '@/screens/family/mensaje-equipo';

/**
 * O2-10b-1a — hilo de EQUIPO del staff (?teamConversationId). Reutiliza la pantalla
 * de familia (lectura E2a + envío por el endpoint F3).
 */
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
