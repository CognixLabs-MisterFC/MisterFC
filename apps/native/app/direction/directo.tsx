import { useLocalSearchParams } from 'expo-router';
import { DirectoDetalleScreen } from '@/screens/family/directo-detalle';

/**
 * D1a — Detalle de un directo para dirección (SOLO LECTURA). `eventId` llega por
 * query desde la card del listado. Reusa `DirectoDetalleScreen` de familia, que es
 * área-neutral (sin router, sin selector de hijo, sin checks de rol; solo lee
 * `activeClub`/`theme` de `useApp()`): dirección es de CONSULTA — para registrar
 * eventos del partido se usa la web, no la app.
 */
export default function Screen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <DirectoDetalleScreen eventId={eventId ?? null} />;
}
