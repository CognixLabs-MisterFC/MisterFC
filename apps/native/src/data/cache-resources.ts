import { invalidateResources } from './cache-bus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MAPA ESCRITURA → RECURSOS DE CACHÉ  (ÚNICO SITIO, mantener aquí)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada ESCRITURA de la app (un `...FromClient` que muta) declara aquí qué
 * RECURSOS de la caché de lectura deja obsoletos. Un "recurso" es el token
 * inicial de una cache-key: en `inicio.<club>.<tutor>` el recurso es `inicio`; en
 * `home.<club>.<team>` es `home`. La invalidación casa por ese token (ver
 * `cache-bus.ts`), así que basta listar el token.
 *
 * POR QUÉ EN UN SOLO SITIO: si la relación escritura→recurso quedara dispersa por
 * las pantallas, se desincronizaría (una escritura nueva olvidaría invalidar algo,
 * o un recurso renombrado dejaría entradas muertas). Aquí se revisa de un vistazo.
 *
 * QUÉ PASA SI AÑADES UNA ESCRITURA Y OLVIDAS INVALIDAR: NO se rompe nada de
 * inmediato. Las demás pantallas seguirán mostrando lo viejo solo hasta que se
 * RE-ENFOQUEN: el refetch-al-enfocar + SWR las refresca al volver a ellas. Es
 * decir, se AUTOCURA al navegar, pero NO se propaga en caliente (misma pantalla
 * sin re-foco, u otra pantalla ya visible). Para propagación inmediata, añade la
 * acción aquí con los recursos que toca y llama a `invalidateAfterWrite(acción)`
 * tras la escritura con éxito.
 *
 * Sobre-listar recursos es SEGURO (solo provoca una recarga de más); infra-listar
 * degrada a "se arregla al re-enfocar". Ante la duda, incluye el recurso.
 */
export const WRITE_INVALIDATIONS = {
  // ── Familia ───────────────────────────────────────────────────────────────
  /** Familia responde una convocatoria del hijo (deja de estar "pendiente"). */
  respondCallup: [
    'inicio',
    'convocatoria',
    'convocatorias',
    'convocatoria-staff',
    'convocatorias-staff',
  ],
  /** Marcar novedades/notificaciones como leídas (feed + contador del inicio). */
  markNotifications: ['novedades', 'inicio', 'anuncios'],
  /** Leer un hilo de mensajería (contador de no leídos del inicio + el hilo).
   *  O2-12: incluye el hilo/bandeja de staff (canal privado entre staff). */
  markConversationRead: ['inbox', 'thread', 'team-thread', 'staff-inbox', 'staff-thread', 'inicio'],
  /** Enviar un mensaje (1:1, equipo o staff): actualiza la bandeja y el hilo. */
  sendMessage: ['inbox', 'thread', 'team-thread', 'staff-inbox', 'staff-thread'],
  /** Seguir/dejar de seguir un equipo en Directos. */
  setTeamFollow: ['directos', 'directos-follow', 'spec-directos'],
  /** Datos médicos del jugador (gestión sensible). */
  setPlayerMedical: ['medical', 'mgmt'],
  /** Foto del jugador (se ve en gestión, plantilla, home de equipo y roster staff). */
  setPlayerPhoto: ['photo-path', 'mgmt', 'plantilla', 'home', 'staff-roster'],
  /** RV-2 — retirar un consentimiento. Sobre-lista a propósito: no se sabe aquí QUÉ
   *  tipo se retiró, y los efectos caen en pantallas distintas. Retirar `image_internal`
   *  apaga `player_photo_visible`, que GATEA LA RLS DE STORAGE: la foto del jugador
   *  deja de poder leerse del bucket, así que todo lo que la pinta sirve algo que ya
   *  no existe. Retirar el médico cierra la ficha. */
  revokeConsent: ['consents', 'photo-path', 'mgmt', 'plantilla', 'home', 'staff-roster', 'medical'],

  /** RV-3 — conceder uno. La MISMA lista que retirar, y por la misma razón: los
   *  efectos son simétricos. Conceder `image_internal` enciende
   *  `player_photo_visible`, así que todo lo que pinta la foto estaba sirviendo un
   *  hueco y ahora hay imagen; conceder el médico abre la ficha. */
  grantConsent: ['consents', 'photo-path', 'mgmt', 'plantilla', 'home', 'staff-roster', 'medical'],

  /** Perfil del tutor (nombre/avatar/idioma). `tutors-contact` porque el tutor se ve
   *  a sí mismo en la tarjeta de contacto de Gestión: cambiarse el nombre o el
   *  teléfono y seguir viendo el viejo ahí es la clase de incoherencia que hace
   *  dudar del dato. A los OTROS tutores no les llega —están en otro móvil— y eso
   *  no lo arregla la caché. */
  updateProfile: ['profile', 'tutors-contact'],

  // ── Staff / entrenador ──────────────────────────────────────────────────────
  /** Marcar asistencia a una sesión (la ve staff y la familia). */
  markAttendance: ['asistencia-sesion', 'asistencia-list', 'asistencia'],
  /** G1 — Crear/planificar la sesión de un entrenamiento: refresca la afordancia
   *  (existe sesión) del detalle del entrenamiento. */
  planSession: ['event-session', 'asistencia-sesion', 'sesion-editar'],
  /** G1 — Editar cabecera/compartir la sesión: el editor y la vista del jugador. */
  sessionEdit: ['sesion-editar', 'sesion', 'entrenamientos'],
  /** Decisión de convocatoria del staff (convoca/descarta) → familia y staff. */
  upsertCallupDecision: [
    'convocatoria-staff',
    'convocatorias-staff',
    'convocatoria',
    'convocatorias',
    'inicio',
  ],
  /** Alineación/posiciones (se refleja en el campo del directo). */
  setLineup: ['alineacion', 'directo', 'directo-estado', 'spec-directo'],
  /** Marcar oficial / compartir con el equipo desde el editor: la vista de la
   *  convocatoria del jugador (tarjeta de alineación compartida) y el editor no
   *  deben servir lo viejo; también toca el campo del directo (lee la oficial). */
  shareLineup: [
    'shared-lineup',
    'convocatoria',
    'convocatorias',
    'alineacion',
    'directo',
    'directo-estado',
    'spec-directo',
  ],
  /** Alta/edición/borrado de anuncio (inicio y home de familia, lista de anuncios). */
  manageAnnouncement: ['anuncios', 'staff-anuncios', 'inicio', 'home'],
  /** Valoraciones y cierre post-partido. */
  postMatch: ['post-partido'],
  /** Crear una conversación de equipo o de staff (bandeja). */
  createConversation: ['inbox', 'staff-inbox'],
  /** Cambios de ESTADO del partido en el control del directo (staff): empezar,
   *  fin de periodo, reloj, finalizar, reabrir. NO cubre los eventos de marcador,
   *  que van por la cola offline (use-event-queue, intocable). */
  matchState: ['directo', 'directo-estado', 'spec-directo', 'directos', 'spec-directos'],
} as const;

export type WriteAction = keyof typeof WRITE_INVALIDATIONS;

/**
 * Invalida la caché afectada por una escritura. Llamar SIEMPRE tras la escritura
 * con ÉXITO (no antes: si la mutación falla no hay nada que invalidar).
 * Fire-and-forget: `void invalidateAfterWrite('respondCallup')`.
 */
export function invalidateAfterWrite(action: WriteAction): Promise<void> {
  return invalidateResources(WRITE_INVALIDATIONS[action]);
}
