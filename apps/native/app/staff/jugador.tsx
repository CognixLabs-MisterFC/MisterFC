import { JugadorFichaScreen } from '@/screens/jugador-ficha';

/**
 * Ficha de un jugador para el CUERPO TÉCNICO (oculta, ?playerId&name). Es la MISMA
 * pantalla que monta dirección: lo que cada uno ve lo recorta la RLS, no el área.
 *
 * Existe este fichero porque un entrenador NO puede entrar en el área de dirección
 * (`isAllowedInArea`: direction→staff sí, staff→direction nunca), así que la ficha
 * que ya había era inalcanzable para él. Se llega tocando un nombre en la plantilla
 * del equipo o en la lista de jugadores del coordinador.
 */
export default function Screen() {
  return <JugadorFichaScreen />;
}
