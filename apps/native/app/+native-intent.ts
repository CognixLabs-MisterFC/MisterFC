import { resolveInvitePath } from '@/deep-links/incoming';

/**
 * R-4 — la puerta por la que entra un enlace del sistema.
 *
 * expo-router llama aquí ANTES de navegar, con la URL tal cual la entrega Android o
 * iOS. Nuestro trabajo es uno solo: el correo enlaza a
 * `https://misterfc.es/{locale}/invite/{token}` y la app no tiene locale en sus rutas,
 * así que hay que traducirlo a `/invite/{token}`. Sin esto el enlace abre la app y
 * aterriza en una ruta que no existe — que para el usuario es idéntico a que el enlace
 * no funcione.
 *
 * `initial` distingue el ARRANQUE EN FRÍO (la app no estaba corriendo y el enlace la
 * abre) de la app ya viva. Aquí se tratan IGUAL a propósito: la pantalla de invitación
 * no depende de ningún estado previo —no hay sesión, el token es la credencial— así que
 * no hay nada que esperar. Tratarlos distinto solo habría añadido un camino más que
 * probar, y el frío es justo el que menos se prueba.
 *
 * LO QUE NO SE TOCA se devuelve tal cual. Esta función la atraviesan TODOS los enlaces,
 * incluidos los que no son nuestros; quedarse con alguno rompería la navegación normal.
 *
 * NO PUEDE LANZAR. Una excepción aquí revienta el arranque en frío, que es la primera
 * impresión de la app. De ahí el try/catch: ante la duda, el camino normal.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    return resolveInvitePath(path) ?? path;
  } catch {
    return path;
  }
}
