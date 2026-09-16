/**
 * Qué se enseña de los tutores en la app de FAMILIA, y qué se puede hacer con ello.
 *
 * Vive aquí y no en la pantalla porque son decisiones con consecuencias —una de
 * ellas de privacidad— y en esta app lo que se prueba es la lógica pura: las
 * pantallas no se renderizan en los tests.
 *
 * NO importa de `@misterfc/core`: el tipo de entrada se declara aquí, estructural.
 * Si el de core cambia de forma, el sitio que los junta (la pantalla) deja de
 * compilar, que es donde queremos enterarnos. Lo que se evita es que un test de
 * lógica pura acabe cargando el cliente de Supabase (la lección de R-3).
 */

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
  /** Quien mira ES este tutor. La fila se pinta, pero sin acciones. */
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
 * El orden llega ya hecho de SQL (`order by relation, full_name`) y no se toca.
 */
export function tutorContactRows(
  tutors: readonly TutorContact[],
  viewerProfileId: string | null,
): TutorContactRow[] {
  return tutors
    .filter((tu) => tu.relation !== 'self')
    .map((tu) => ({ ...tu, isViewer: tu.tutorProfileId === viewerProfileId }));
}

export type ContactAction = {
  kind: 'call' | 'mail';
  /** Lo que se abre. */
  href: string;
  /** Lo que se le enseña a quien va a pulsar, ANTES de abrir nada. */
  value: string;
};

/**
 * Las acciones de una fila. Devolver una lista y no pintar botones a pelo es lo que
 * permite que la pantalla no tenga que decidir nada:
 *
 *  · sin dato no hay acción (un botón «Llamar» sin número es una promesa falsa),
 *  · sobre uno mismo no hay acción (llamarte a ti no es una funcionalidad),
 *  · el `value` viaja junto al `href` para que la confirmación pueda enseñar A QUIÉN
 *    se va a llamar o escribir. Son datos personales de un adulto: la acción tiene
 *    que ser deliberada, no un toque que marca sin avisar.
 *
 * En el `tel:` se quitan los espacios —hay marcadores que se atragantan con ellos—
 * pero el `value` conserva el número TAL CUAL está guardado, que es como lo
 * reconoce quien lo lee.
 */
export function contactActionsFor(row: TutorContactRow): ContactAction[] {
  if (row.isViewer) return [];

  const actions: ContactAction[] = [];
  const phone = row.phone?.trim();
  const email = row.email?.trim();

  if (phone) actions.push({ kind: 'call', href: `tel:${phone.replace(/\s+/g, '')}`, value: phone });
  if (email) actions.push({ kind: 'mail', href: `mailto:${email}`, value: email });

  return actions;
}
