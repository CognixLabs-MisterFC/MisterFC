import { useLocalSearchParams } from 'expo-router';
import { MensajeDetalleScreen } from '@/screens/family/mensaje-detalle';

/** O2-11a-1 — hilo 1:1 de dirección (?conversationId). Reutiliza la pantalla generica. */
export default function Screen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  return (
    <MensajeDetalleScreen conversationId={conversationId ?? null} title={title ?? null} />
  );
}
