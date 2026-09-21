/**
 * Qué se enseña de los tutores en la app de FAMILIA, y qué se puede hacer con ello.
 *
 * Vive aquí y no en la pantalla porque son decisiones con consecuencias —una de
 * ellas de privacidad— y en esta app lo que se prueba es la lógica pura: las
 * pantallas no se renderizan en los tests.
 *
 * NO HAY ACCIONES, Y ES DELIBERADO. Hubo botones de llamar y escribir detrás de una
 * confirmación; Jose los quitó. El contacto de los tutores se LEE: nombre, correo y
 * teléfono en texto, y nada que abra el marcador ni el cliente de correo. Si alguien
 * los echa de menos, la decisión es suya, no un olvido.
 *
 * NO importa del BARREL de `@misterfc/core`: el tipo de entrada se declara aquí,
 * estructural. Si el de core cambia de forma, el sitio que los junta (la pantalla)
 * deja de compilar, que es donde queremos enterarnos. Lo que se evita es que un
 * test de lógica pura acabe cargando el cliente de Supabase (la lección de R-3):
 * medido, el barrel sube el `collect` de este test de 0,5 s a 10,4 s.
 *
 * La REGLA de quién es tutor sí viene de core, por `@misterfc/core/rules`, que es
 * la entrada sin cliente creada justo para esto. Antes estaba copiada a mano aquí
 * y en core; una regla escrita dos veces acaba diciendo dos cosas.
 */
import { isTutorAccount } from '@misterfc/core/rules';

/** Estructuralmente `PlayerTutorContact` de core. */
export type TutorContact = {
  tutorProfileId: string;
  fullName: string | null;
  /** parent | guardian | self — el enum de `player_accounts`. */
  relation: string;
  email: string | null;
  phone: string | null;
};

export type TutorContactRow = TutorContact & {
  /** Quien mira ES este tutor. La fila se pinta, marcada. */
  isViewer: boolean;
};

/**
 * La RPC devuelve TODAS las filas de `player_accounts` del jugador, y eso incluye
 * la del propio jugador (`relation = 'self'`).
 *
 * AQUÍ SE CAE, y por dos motivos que apuntan al mismo sitio:
 *
 *  1. Esta tarjeta es «el contacto de tus tutores». El jugador no es tutor suyo.
 *  2. `get_player_tutors_contact` es SECURITY DEFINER, así que se salta la RLS de
 *     `player_accounts` — la misma RLS que le OCULTA al tutor la fila 'self' de su
 *     hijo (está documentado en la tarjeta de acceso de Gestión). Pintarla aquí
 *     enseñaría por la puerta de atrás justo lo que la otra puerta tapa.
 *
 * La fila de quien mira SÍ se queda, marcada. Un tutor viendo su propia ficha de
 * contacto no es ruido: es lo que los demás ven de él.
 *
 * El filtro va en POSITIVO —parent y guardian— y no como «todo menos self»: un
 * cuarto valor de `relation` no debe colarse solo en la lista de la familia. La
 * lista vive en core (`TUTOR_RELATIONS`) y se lee desde aquí: una sola.
 *
 * El orden llega ya hecho de SQL (`order by relation, full_name`) y no se toca.
 */
export function tutorContactRows(
  tutors: readonly TutorContact[],
  viewerProfileId: string | null,
): TutorContactRow[] {
  return tutors
    .filter(isTutorAccount)
    .map((tu) => ({ ...tu, isViewer: tu.tutorProfileId === viewerProfileId }));
}
