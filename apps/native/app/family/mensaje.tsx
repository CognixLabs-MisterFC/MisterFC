import { useLocalSearchParams } from 'expo-router';
import { MensajeDetalleScreen } from '@/screens/family/mensaje-detalle';

/** O2-5 E2a — hilo 1:1 (conversationId por navegación). */
export default function Screen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  return (
    <MensajeDetalleScreen conversationId={conversationId ?? null} title={title ?? null} />
  );
}
