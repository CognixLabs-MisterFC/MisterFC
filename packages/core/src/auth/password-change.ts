/**
 * ¿ESTA SESIÓN TIENE QUE FIJAR UNA CONTRASEÑA NUEVA ANTES DE SEGUIR?
 *
 * Decisión pura sobre las reclamaciones del JWT, para que la pueda probar
 * alguien y no viva dentro de un `if` del middleware.
 *
 * ── LA SEÑAL, Y POR QUÉ ES ESTA ────────────────────────────────────────────
 *
 * Una sesión que nace del enlace de recuperación NO es igual que una sesión
 * normal, y la diferencia va firmada en el token: la reclamación `amr`
 * (authentication methods references) dice cómo se autenticó. MEDIDO contra
 * GoTrue de producción (21-09-2026, sonda con cuenta desechable):
 *
 *   entrar con contraseña ....... amr = [{ method: "password" }]
 *   llegar por el enlace ........ amr = [{ method: "otp"      }]
 *
 * Y medido también lo que NO sirve: `amr` no cambia al cambiar la contraseña,
 * ni en el token que ya se tenía ni en uno refrescado. Marca el ORIGEN de la
 * sesión, no si ya se fijó una contraseña. Por eso la acción de
 * `/reset-password` vuelve a autenticar al terminar (#678): eso crea una sesión
 * NUEVA, con `amr` de contraseña, y este candado se abre solo.
 *
 * Ese es el motivo de que aquí no haya estado que mantener — ni cookie, ni
 * tabla, ni migración—: la respuesta sale entera del token, y el token lo firma
 * GoTrue.
 *
 * ── QUÉ SE EXIGE, EXACTAMENTE ──────────────────────────────────────────────
 *
 * `otp` presente Y `password` ausente. Las dos condiciones, y no solo la
 * primera:
 *
 *   · Solo «`password` ausente» sería demasiado ancho: cualquier método que no
 *     sea contraseña —un OAuth el día que exista— caería en el candado, y ahí
 *     forzar una contraseña sería un disparate.
 *   · Solo «`otp` presente» dejaría encerrada a una sesión que se hubiera
 *     autenticado por los dos caminos. Hoy no pasa (volver a autenticar crea
 *     una sesión nueva y limpia), pero la regla no depende de que siga así.
 *
 * ── LO QUE HAY QUE VIGILAR ─────────────────────────────────────────────────
 *
 * `otp` es GENÉRICO: es el método de cualquier enlace de un solo uso, no solo
 * el de recuperación. Hoy en este producto solo puede venir de ahí, y está
 * censado: el correo de invitación lleva a `/{locale}/invite/{token}` DIRECTO
 * (con `{{ .RedirectTo }}`, sin `/verify`, así que no crea sesión), la plantilla
 * de magic link está retirada, `signInWithOtp` no aparece en el repo,
 * `updateUser` se usa en un solo sitio y solo para contraseñas —o sea que no hay
 * cambio de correo— y con `mailer_autoconfirm` no hay correo de alta.
 *
 * SI ALGÚN DÍA VUELVE UN MAGIC LINK, esto lo atraparía, y ahí estaría MAL:
 * entrar por magic link es un método de acceso legítimo, no una recuperación a
 * medias. Quien lo reintroduzca tiene que pasar por aquí y decidir.
 */

/** Una entrada de `amr`. Todo opcional: viene de un JWT, no de nuestro código. */
export type AuthMethodReference = {
  method?: string | null;
  timestamp?: number | null;
};

/** El método de los enlaces de un solo uso. El de recuperación es uno de ellos. */
const OTP = 'otp';
/** El método de quien ha tecleado su contraseña. */
const PASSWORD = 'password';

/**
 * Lee los métodos de un `amr` que llega SIN TIPAR (lo que haya en el token).
 *
 * Es defensivo a propósito: si `amr` no está, no es un array o trae elementos
 * raros, la respuesta es «no hay métodos» y el candado NO se cierra. Un token
 * que no sepamos leer no debe dejar a nadie fuera de la aplicación; el peor caso
 * de equivocarse por aquí es que alguien siga usando su contraseña vieja un rato
 * más, y el de equivocarse por el otro lado es un bucle sin salida.
 */
export function authMethodsFrom(amr: unknown): string[] {
  if (!Array.isArray(amr)) return [];
  return amr
    .map((entry) =>
      entry !== null && typeof entry === 'object' && 'method' in entry
        ? (entry as AuthMethodReference).method
        : null,
    )
    .filter((method): method is string => typeof method === 'string' && method.length > 0);
}

/**
 * `true` si esta sesión llegó por un enlace de un solo uso y todavía no ha
 * fijado contraseña.
 */
export function requiresPasswordChange(amr: unknown): boolean {
  const methods = authMethodsFrom(amr);
  return methods.includes(OTP) && !methods.includes(PASSWORD);
}
