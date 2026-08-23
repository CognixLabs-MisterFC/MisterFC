import { useLocalSearchParams } from 'expo-router';
import { getEventSessionIdFromClient, eventScopedCacheKey } from '@misterfc/core';
import { useCached } from '@/data/use-cached';
import { LoadingScreen } from '@/ui/feedback';
import { SesionDetalleScreen } from '@/screens/family/sesion-detalle';
import { EntrenamientoDetalleScreen } from '@/screens/family/entrenamiento-detalle';

/**
 * D1b-3/D1b-4 — Visor de sesión para dirección (SOLO LECTURA). Dos entradas:
 *  · Lista de Sesiones (D1b-3): `?sessionId` directo → visor, sin resolución.
 *  · Calendario del equipo (D1b-4): `?eventId` (+ title/startsAt/locationName). El
 *    evento del calendario trae `has_session` pero no el id de la sesión; aquí se
 *    resuelve con `getEventSessionIdFromClient`. Tres casos del entreno (decisión ③):
 *      1) resuelve el sessionId → visor de sesión read-only.
 *      2) no resuelve (sesión borrada / carrera) → detalle de entreno read-only
 *         (NO pantalla en blanco), con los params que llegan de más.
 *      (has_session=false ni siquiera pasa por aquí: va directo a
 *       `/direction/entrenamiento` desde `directionEventTarget`.)
 * `allowUnshared`: el director ve las sesiones asignadas al entrenamiento, compartidas
 * o no (las plantillas de biblioteca siguen fuera). La RLS `sessions_select` ya incluye
 * a dirección. Sin `past`/`attendanceCode`: la asistencia es del jugador, no del director.
 */
export default function Screen() {
  const { sessionId, eventId, title, startsAt, locationName } = useLocalSearchParams<{
    sessionId?: string;
    eventId?: string;
    title?: string;
    startsAt?: string;
    locationName?: string;
  }>();

  // Resolución eventId→sessionId SOLO en modo calendario (eventId sin sessionId
  // directo). Con sessionId directo, key inerte (`.none`) → no consulta.
  const resolveFromEvent = !sessionId && !!eventId;
  const { data, loading } = useCached<{ sessionId: string | null }>(
    eventScopedCacheKey('dir-sesion-de-evento', resolveFromEvent ? (eventId as string) : 'none'),
    async (sb) => {
      if (!resolveFromEvent || !eventId) return { sessionId: null };
      return { sessionId: await getEventSessionIdFromClient(sb, eventId) };
    },
  );

  // Modo directo (lista de Sesiones): sessionId conocido → visor.
  if (sessionId) return <SesionDetalleScreen sessionId={sessionId} allowUnshared />;

  // Modo calendario: espera la resolución del id de la sesión.
  if (resolveFromEvent && loading) return <LoadingScreen />;
  if (data?.sessionId) return <SesionDetalleScreen sessionId={data.sessionId} allowUnshared />;

  // El id no resuelve (sesión borrada/carrera) → detalle de entreno read-only.
  return (
    <EntrenamientoDetalleScreen
      title={title ?? null}
      startsAt={startsAt ?? null}
      locationName={locationName || null}
    />
  );
}
