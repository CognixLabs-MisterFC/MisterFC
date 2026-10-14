/**
 * QUIÉN PUEDE LANZAR LA IMPORTACIÓN DE PARTIDOS FEDERADOS.
 *
 * Decisión de producto (14-10-2026): **solo el superadmin de plataforma**. Hasta
 * hoy podían `admin_club` y `director` del club activo.
 *
 * ── POR QUÉ ESTA FUNCIÓN NO RECIBE EL ROL ────────────────────────────────────
 * La puerta vieja era `rol !== 'admin_club' && rol !== 'director'`. Si esto
 * siguiera aceptando un rol, bastaría con que alguien añadiera un `|| rol ===
 * 'director'` —o con que una pantalla nueva pasara el rol en vez del superadmin—
 * para que la decisión de hoy se deshiciera sin que nada se pusiera rojo.
 *
 * Así que el ROL NO ES UN PARÁMETRO. No es un aviso en un comentario: es que no
 * existe el dato con el que equivocarse. Volver a abrir la puerta a un rol exige
 * cambiar esta firma, y cambiar la firma rompe los dos sitios que la llaman y los
 * tests. Es la diferencia entre un comentario que avisa y un tipo que impide.
 *
 * ── Y POR QUÉ `is_superadmin()` Y NO «el rol admin_club» ─────────────────────
 * Porque son indistinguibles. Cuando un superadmin entra en un club ajeno desde
 * la consola, `apps/web/src/lib/auth-shell.ts` le fabrica un acceso SINTÉTICO con
 * `role: 'admin_club'` (F14B-8). Mirar el rol no sabría separar «el admin de este
 * club» de «el superadmin de visita», que es exactamente la distinción que pide
 * esta decisión. La única fuente de verdad es `is_superadmin()` (F14B-1,
 * SECURITY DEFINER sobre `platform_admins`).
 *
 * Esto NO es el único cierre: el INSERT de los eventos va con el cliente del
 * USUARIO y lo decide la RLS (`user_can_manage_event`). Lo que la RLS no puede
 * hacer es distinguir un partido importado de uno creado a mano —un director
 * crea eventos a mano porque es su trabajo—, así que el cierre específico de la
 * importación vive aquí, en el servidor, delante de las 458 llamadas a la FFCV.
 */

/**
 * Lo que hace falta saber del actor. Tres booleanos: nada de roles, nada de
 * clientes de base de datos. Se puede responder desde un `expect`.
 */
export type ActorFfcv = {
  /** ¿Hay sesión? (sin ella la respuesta es 401, no 403.) */
  haySesion: boolean;
  /** ¿Hay club activo? El botón es de la web: sin club no hay qué importar. */
  hayClubActivo: boolean;
  /** `is_superadmin()`: la única fuente de verdad. */
  esSuperadmin: boolean;
};

/**
 * El motivo viaja con el «no» para que el llamador elija el status correcto
 * (401 vs 403) sin volver a decidir la regla por su cuenta.
 */
export type PermisoFfcv =
  | { puede: true }
  | { puede: false; motivo: 'sin_sesion' | 'sin_club_activo' | 'no_superadmin' };

/** La puerta. El orden importa: primero la sesión, que decide 401 frente a 403. */
export function permisoImportarFfcv(actor: ActorFfcv): PermisoFfcv {
  if (!actor.haySesion) return { puede: false, motivo: 'sin_sesion' };
  if (!actor.hayClubActivo) return { puede: false, motivo: 'sin_club_activo' };
  if (!actor.esSuperadmin) return { puede: false, motivo: 'no_superadmin' };
  return { puede: true };
}
