import { useLocalSearchParams } from 'expo-router';
import { MensajeStaffScreen } from '@/screens/staff/mensaje-staff';

/**
 * O2-12 — Ruta OCULTA (href:null): hilo 1:1 privado entre staff en dirección
 * (?conversationId). Reutiliza la pantalla de staff; dirección también es staff.
 */
export default function Screen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  return (
    <MensajeStaffScreen conversationId={conversationId ?? null} title={title ?? null} />
  );
}
