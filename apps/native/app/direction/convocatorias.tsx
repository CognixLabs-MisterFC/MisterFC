import { useLocalSearchParams } from 'expo-router';
import { ConvocatoriasStaffListScreen } from '@/screens/staff/convocatorias';

/**
 * D1b-2 — Convocatorias del equipo para dirección (SOLO LECTURA). Reusa la lista de
 * staff acotada al `teamId` del hub (el loader ya es club-wide `kind:'all'` para el
 * director); cada fila abre el detalle read-only en `/direction/convocatoria`.
 */
export default function Screen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  return (
    <ConvocatoriasStaffListScreen
      teamId={teamId ?? null}
      detailPathname="/direction/convocatoria"
    />
  );
}
