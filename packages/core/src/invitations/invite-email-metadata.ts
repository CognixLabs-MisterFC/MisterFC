/**
 * A-1 — Metadatos del correo de invitación.
 *
 * GoTrue tiene UNA sola plantilla de invitación y la reciben los cinco tipos de
 * destinatario. Decía «has recibido una invitación para unirte al cuerpo técnico
 * de tu club» a todo el mundo: al padre de un jugador, al abuelo que solo mira
 * los partidos y al propio menor.
 *
 * La plantilla ramifica con `{{ if eq .Data.invite_kind "tutor" }}`. `.Data` es
 * el `user_metadata` del invitado, así que lo que se ponga aquí es lo que la
 * plantilla puede leer — asunto incluido: en GoTrue v2.197 el asunto se parsea
 * y se ejecuta con el MISMO mapa de datos que el cuerpo
 * (`internal/mailer/templatemailer/template.go`, `loadEntrySubject` + `execute`).
 *
 * Existe como helper, y no como objeto escrito siete veces, porque el valor de
 * esto es que NO falte en ninguno: un sender que se deje `invite_kind` cae en la
 * rama neutra de la plantilla sin que nadie se entere. Aquí el tipo obliga.
 *
 * `invite_locale` es el idioma de QUIEN INVITA (el que ya viaja en el
 * `redirectTo`). No hay nada mejor: el invitado todavía no tiene cuenta, así que
 * no tiene idioma propio.
 *
 * NO es un dato de seguridad. `user_metadata` lo puede escribir el propio
 * usuario; sirve para elegir un texto, nunca para decidir un permiso.
 */

/** Los cinco destinatarios posibles de un correo de invitación. */
export const INVITE_KINDS = [
  /** Cuerpo técnico invitado desde /invitations. */
  'staff',
  /** Administrador de club, invitado desde la consola de plataforma. */
  'admin',
  /** Padre, madre o tutor legal de un jugador. */
  'tutor',
  /** Seguidor (abuelo, familiar): mira, no gestiona, y NO entra en el club. */
  'seguidor',
  /** La cuenta propia del menor. */
  'menor',
] as const;

export type InviteKind = (typeof INVITE_KINDS)[number];

export type InviteEmailMetadata = {
  invite_pending: true;
  invitation_id: string;
  invite_kind: InviteKind;
  invite_locale: string;
};

/**
 * Construye el `data` de `inviteUserByEmail`. `invite_pending` e `invitation_id`
 * son los de siempre (la página de invitación los lee); los dos nuevos solo los
 * lee la plantilla del correo.
 */
export function inviteEmailMetadata(args: {
  invitationId: string;
  kind: InviteKind;
  locale: string;
}): InviteEmailMetadata {
  return {
    invite_pending: true,
    invitation_id: args.invitationId,
    invite_kind: args.kind,
    invite_locale: args.locale,
  };
}
