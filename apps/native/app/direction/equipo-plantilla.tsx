import { router, useLocalSearchParams } from 'expo-router';
import { PlantillaScreen } from '@/screens/family/plantilla';

/**
 * D1b-1 — Plantilla del equipo para dirección (SOLO LECTURA). Reusa la pantalla de
 * familia, que es área-neutral: recibe `teamId` por param y se alimenta del loader
 * club-wide `getTeamRosterStatsFromClient(teamId)`.
 *
 * LO QUE AÑADE DIRECCIÓN es poder abrir la ficha del jugador. La pantalla compartida
 * no navega por su cuenta —en familia estos son los COMPAÑEROS del hijo, y abrirles
 * la ficha sería enseñarle a un padre los datos del hijo de otro—, así que la
 * capacidad la trae quien la monta. Aquí sí: es la misma ficha club-wide de solo
 * lectura a la que ya se llega desde el menú → Jugadores.
 *
 * El `name` viaja como parámetro por el mismo motivo que en la lista de Jugadores: la
 * ficha lo usa de título mientras carga, en vez de dejar la cabecera en blanco.
 */
export default function Screen() {
  const { teamId, name } = useLocalSearchParams<{ teamId?: string; name?: string }>();
  return (
    <PlantillaScreen
      teamId={teamId ?? null}
      teamName={name ?? null}
      onOpenPlayer={(playerId, playerName) =>
        router.push({ pathname: '/direction/jugador', params: { playerId, name: playerName } })
      }
    />
  );
}
