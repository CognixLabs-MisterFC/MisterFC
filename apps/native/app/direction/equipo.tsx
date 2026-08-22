import { useLocalSearchParams } from 'expo-router';
import { DireccionEquipoDetalleScreen } from '@/screens/direction/equipo-detalle';

/** D1b-1 — Detalle de un equipo (?teamId), alcanzado desde la lista de Equipos. */
export default function Screen() {
  const { teamId, name, color } = useLocalSearchParams<{
    teamId?: string;
    name?: string;
    color?: string;
  }>();
  return (
    <DireccionEquipoDetalleScreen
      teamId={teamId ?? null}
      name={name ?? null}
      color={color ?? null}
    />
  );
}
