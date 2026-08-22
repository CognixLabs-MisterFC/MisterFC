import { useLocalSearchParams } from 'expo-router';
import { PlantillaScreen } from '@/screens/family/plantilla';

/**
 * D1b-1 — Plantilla del equipo para dirección (SOLO LECTURA). Reusa la pantalla de
 * familia, que es área-neutral: recibe `teamId` por param, se alimenta del loader
 * club-wide `getTeamRosterStatsFromClient(teamId)` y no navega hacia fuera.
 */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return <PlantillaScreen teamId={teamId ?? null} teamName={name ?? null} />;
}
