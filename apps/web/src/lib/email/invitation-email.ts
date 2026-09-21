import 'server-only';
import { getTranslations } from 'next-intl/server';
import type { InviteKind, SendInvitationInput } from '@misterfc/core';
import type { EmailMessage } from './resend';
import { maquetar, enTexto } from './email-layout';

/**
 * Correo-B1 — La plantilla del correo de invitación.
 *
 * Vive aquí y no en el dashboard de Supabase (que es donde vivía) por tres razones,
 * y la tercera es la que motivó la serie:
 *   · se revisa en un PR como cualquier otro código;
 *   · el asunto no está limitado a 255 caracteres ni escrito en plantillas Go;
 *   · y puede componerse en el idioma del DESTINATARIO, porque aquí sí se sabe cuál
 *     es. La plantilla de GoTrue no puede leer `profiles.locale`.
 *
 * Los textos viven en `messages/{es,en,va}.json` bajo `emails.spectator_invite`, con
 * el resto del producto: un correo es interfaz, y no tiene por qué traducirse en otro
 * sitio ni con otras herramientas.
 *
 * La maqueta (el HTML pobre a propósito y su gemelo en texto plano) vive en
 * `email-layout.ts` desde que hay un segundo correo que la usa entera. Aquí solo
 * quedan los textos y qué texto le toca a cada tipo de invitación.
 */

/**
 * Qué textos usa cada tipo de invitación. La serie Correo-B va añadiendo entradas
 * según migra senders; los que faltan siguen saliendo por la plantilla de Supabase.
 *
 * `InviteKind` viene de core y es el MISMO valor que el sender mete en el
 * `user_metadata` de la cuenta, así que no hay dos listas que mantener a la vez.
 */
const NAMESPACE_BY_KIND: Partial<Record<InviteKind, string>> = {
  seguidor: 'emails.spectator_invite',
  menor: 'emails.self_invite',
  admin: 'emails.admin_invite',
  tutor: 'emails.tutor_invite',
  staff: 'emails.staff_invite',
};

/**
 * `staff` es el ÚNICO tipo cuyo texto cambia según el ROL con el que se invita, y por
 * eso es el único que exige `role`.
 *
 * El motivo es que ese tipo cubre los seis roles del formulario de Invitaciones, no
 * solo el cuerpo técnico: mientras el correo lo mandaba GoTrue, a la persona que iba a
 * administrar el club y a una familia les llegaba el mismo texto, «te han invitado a
 * unirte al cuerpo técnico de tu club». Con el correo en código el papel se puede
 * decir, y decirlo es lo que hace que el invitado sepa a qué acepta.
 *
 * Es un `Record` TOTAL a propósito: si algún día `sendInvitationSchema` admite un rol
 * nuevo, esto deja de compilar y quien lo añada tiene que escribir su texto. Un
 * fallback silencioso mandaría el correo diciendo menos de lo que debía, y eso no se
 * nota nunca.
 */
type StaffInviteRole = SendInvitationInput['role'];
const ROL_CON_TEXTO: Record<StaffInviteRole, true> = {
  admin_club: true,
  director: true,
  coordinador: true,
  entrenador_principal: true,
  entrenador_ayudante: true,
  jugador: true,
};

/**
 * Correo de invitación del tipo que sea, en el idioma que se le pase.
 *
 * NO dice el nombre del jugador, y es deliberado: a esa dirección todavía no hay
 * nadie identificado —puede estar mal escrita— y el nombre de un menor no se manda a
 * una dirección sin comprobar. Quién es se ve al entrar, después del enlace, que
 * exige el token.
 *
 * Un `kind` sin textos LANZA en vez de mandar algo genérico: el sender lo trata como
 * cualquier fallo de correo y queda el rastro. Un correo mudo no se nota.
 */
export async function invitationEmail(args: {
  kind: InviteKind;
  locale: string;
  url: string;
  /** Obligatorio para `staff` (y solo para él): el papel con el que se invita. */
  role?: string;
}): Promise<EmailMessage> {
  const namespace = NAMESPACE_BY_KIND[args.kind];
  if (!namespace) {
    throw new Error(`invitationEmail: no hay textos para el tipo '${args.kind}'`);
  }

  // Igual que un `kind` sin textos: un rol desconocido LANZA en vez de caer en un
  // texto genérico. El sender lo trata como cualquier fallo de correo y queda rastro.
  const porRol = args.kind === 'staff';
  const rol = args.role as StaffInviteRole | undefined;
  if (porRol && !(rol && rol in ROL_CON_TEXTO)) {
    throw new Error(`invitationEmail: el tipo 'staff' necesita un rol conocido (llegó '${args.role}')`);
  }

  const t = await getTranslations({ locale: args.locale, namespace });

  const piezas = {
    heading: porRol ? t(`roles.${rol}.heading`) : t('heading'),
    body: porRol ? t(`roles.${rol}.body`) : t('body'),
    cta: t('cta'),
    url: args.url,
    fallback: t('fallback'),
    ignore: t('ignore'),
    signature: t('signature'),
  };

  return {
    subject: porRol ? t(`roles.${rol}.subject`) : t('subject'),
    html: maquetar(piezas),
    text: enTexto(piezas),
  };
}
