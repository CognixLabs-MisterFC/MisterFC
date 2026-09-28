import { useLocalSearchParams } from 'expo-router';
import { CuerpoTecnicoScreen } from '@/screens/family/cuerpo-tecnico';
import { AddStaffAction } from '@/screens/direction/add-staff-modal';

/**
 * D1b-1 — Cuerpo técnico del equipo para dirección. Reusa la pantalla de familia
 * (área-neutral: `teamId` por param, loader club-wide `getTeamStaffLightFromClient`,
 * sin navegación de salida ni contacto).
 *
 * W-3 — y AQUÍ, solo aquí, se le pasa «Añadir staff». La pantalla la comparte con
 * `/family/equipo-cuerpo-tecnico`, así que la acción no puede vivir dentro de ella:
 * se la enseñaría a los padres. La ruta de familia no pasa `action` y no se ha
 * tocado.
 *
 * `AddStaffAction` trae su propio candado: a un coordinador solo le sale el botón en
 * los equipos que COORDINA, que son los únicos donde la RLS le acepta el INSERT.
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
      action={
        teamId
          ? (refresh) => <AddStaffAction teamId={teamId} refresh={refresh} />
          : undefined
      }
    />
  );
}
