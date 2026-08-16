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
  respondCallup: ['inicio', 'convocatoria', 'convocatorias', 'convocatoria-staff', 'convocatorias-staff'],
  /** Marcar novedades/notificaciones como leídas (feed + contador del inicio). */
  markNotifications: ['novedades', 'inicio', 'anuncios'],
  /** Leer un hilo de mensajería (contador de no leídos del inicio + el hilo). */
  markConversationRead: ['inbox', 'thread', 'team-thread', 'inicio'],
  /** Enviar un mensaje (1:1 o de equipo): actualiza la bandeja y el hilo. */
  sendMessage: ['inbox', 'thread', 'team-thread'],
  /** Seguir/dejar de seguir un equipo en Directos. */
  setTeamFollow: ['directos', 'directos-follow', 'spec-directos'],
  /** Datos médicos del jugador (gestión sensible). */
  setPlayerMedical: ['medical', 'mgmt'],
  /** Foto del jugador (se ve en gestión, plantilla, home de equipo y roster staff). */
  setPlayerPhoto: ['photo-path', 'mgmt', 'plantilla', 'home', 'staff-roster'],
  /** Perfil del tutor (nombre/avatar/idioma). */
  updateProfile: ['profile'],

  // ── Staff / entrenador ──────────────────────────────────────────────────────
  /** Marcar asistencia a una sesión (la ve staff y la familia). */
  markAttendance: ['asistencia-sesion', 'asistencia-list', 'asistencia'],
  /** Decisión de convocatoria del staff (convoca/descarta) → familia y staff. */
  upsertCallupDecision: ['convocatoria-staff', 'convocatorias-staff', 'convocatoria', 'convocatorias', 'inicio'],
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
  /** Crear una conversación de equipo (bandeja). */
  createConversation: ['inbox'],
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
