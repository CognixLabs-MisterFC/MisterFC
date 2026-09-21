/**
 * REGLAS PURAS de core: lo que se puede importar sin arrastrar nada.
 *
 * `@misterfc/core` (el barrel de `index.ts`) reexporta `supabase/index`, y con él
 * `@supabase/supabase-js` y `@supabase/ssr`. Eso está bien para quien va a hablar
 * con la base de datos, y muy mal para un test de lógica pura: medido en la app
 * nativa, importar el barrel en un test trivial pasa de **0,5 s a 10,4 s de
 * `collect`**, porque hay que transformar el paquete entero para leer una función
 * de tres líneas.
 *
 * Esa es la razón —y la única— por la que reglas de core acabaron copiadas a mano
 * en `apps/native` (la «lección R-3»: `player-contact/tutor-rows.ts`,
 * `messaging/family-recipients.ts`). Una regla escrita dos veces es una regla que
 * un día dirá dos cosas distintas.
 *
 * Esta entrada existe para cerrar esa puerta: `@misterfc/core/rules` NO importa el
 * cliente de Supabase, ni Zod, ni nada que hable con la red. Solo funciones y
 * constantes que se pueden probar con un `expect`.
 *
 * REGLA PARA QUIEN AÑADA AQUÍ: si el módulo que quieres reexportar importa
 * —aunque sea de refilón— `../supabase/...`, un esquema de Zod o un tipo de
 * `Database`, NO entra. El guard `check:core-rules-puras` lo comprueba y pone el
 * PR en rojo.
 */

export {
  TUTOR_RELATIONS,
  isTutorAccount,
  hasLinkedFamily,
} from './players/family-link';

/**
 * Los enlaces profundos. Entra ENTERO porque `deep-links/index.ts` no importa
 * nada: son constantes y dos funciones que arman texto.
 *
 * Lo que cierra: `apps/native/src/deep-links/incoming.ts` tenia el host y los
 * idiomas escritos A MANO, y la cabecera de ese mismo modulo de core avisa de que
 * ese es justo el modo en que esto falla —si una copia se queda atras, el enlace
 * deja de abrir la app y NO hay ningun error—. Ahora los lee de aqui.
 */
export {
  DEEP_LINK_HOST,
  DEEP_LINK_LOCALES,
  INVITE_SEGMENT,
  WEB_ORIGIN,
  inviteLink,
  inviteLinkBase,
} from './deep-links/index';
