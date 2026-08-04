import { useLocalSearchParams } from 'expo-router';
import { MensajeDetalleScreen } from '@/screens/family/mensaje-detalle';

/**
 * O2-10b-1a — hilo 1:1 del staff (?conversationId). Reutiliza la pantalla de familia
 * (lectura E2a + envío por el endpoint F3); solo cambia el área de navegación.
 */
export default function Screen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  return (
    <MensajeDetalleScreen conversationId={conversationId ?? null} title={title ?? null} />
  );
}
