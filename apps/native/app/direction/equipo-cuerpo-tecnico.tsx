import { useLocalSearchParams } from 'expo-router';
import { CuerpoTecnicoScreen } from '@/screens/family/cuerpo-tecnico';

/**
 * D1b-1 — Cuerpo técnico del equipo para dirección (SOLO LECTURA). Reusa la pantalla
 * de familia (área-neutral: `teamId` por param, loader club-wide
 * `getTeamStaffLightFromClient`, sin navegación de salida ni contacto).
 */
export default function Screen() {
  const { teamId, name, color } = useLocalSearchParams<{
    teamId?: string;
    name?: string;
    color?: string;
  }>();
  return (
    <CuerpoTecnicoScreen
      teamId={teamId ?? null}
      teamName={name ?? null}
      color={color ?? null}
    />
  );
}
