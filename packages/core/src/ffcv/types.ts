/**
 * F-3 · Tipos del lector de la FFCV.
 *
 * Los nombres de campo de los payloads son los REALES, copiados de las respuestas medidas
 * el 2026-10-12 contra `ffcv.es/competiciones/api/`. No se renombran ni se adivinan: un
 * fixture con claves inventadas da un verde que no mide nada (lección del repo), así que
 * los tipos crudos llevan el vocabulario de ellos —`codequipo`, `codacta`, `cod_grupo`— y
 * la traducción al vocabulario de MisterFC se hace en un solo sitio, al mapear.
 */

/** `fetch` inyectable: los tests no tocan la red y el servidor usa el global. */
export type FfcvFetch = (url: string, init?: RequestInit) => Promise<Response>;

// ── Payloads crudos ──────────────────────────────────────────────────────────────────

/** `api/equipos/ver_equipo.php?codequipo=` — 33 campos; aquí solo los que se usan. */
export type VerEquipoCrudo = {
  estado?: string;
  codigo_equipo?: string;
  codigo_club?: string;
  clave_acceso?: string;
  nombre_equipo?: string;
  categoria?: string;
  codigo_categoria?: string;
  codigo_campo?: string;
  campo?: string;
};

/** `api/filtros/competiciones_fetch.php?cod_temporada=` */
export type CompeticionCruda = {
  codigo?: string;
  nombre?: string;
  CodigoCategoria?: string;
  NombreCategoria?: string;
  Activa?: string;
};

/** `api/filtros/grupos_fetch.php?cod_competicion=` */
export type GrupoCrudo = {
  codigo?: string;
  nombre?: string;
  total_jornadas?: string;
  total_equipos?: string;
};

/** `api/filtros/jornadas_fetch.php?cod_grupo=` — `fecha_jornada` viene dd-mm-yyyy. */
export type JornadaCruda = {
  codjornada?: string;
  nombre?: string;
  fecha_jornada?: string;
};

/**
 * `api/partidos/resultados_por_grupo_jornada_data.php?…`
 *
 * `fecha` viene dd/mm/yyyy (con barras) y `hora` HH:MM, los dos en hora local de Madrid.
 * `estado` es '0' sin jugar y '1' jugado. `resultado` es '0' antes del partido y la cadena
 * '1 - 1' después — y NO se lee: decisión de Jose del 2026-10-12, el marcador lo ponen los
 * entrenadores desde el directo (F-5 cancelada).
 */
export type PartidoCrudo = {
  codacta?: string;
  fecha?: string;
  hora?: string;
  campo?: string;
  local?: string;
  visitante?: string;
  cod_equipo_local?: string;
  cod_equipo_visitante?: string;
  estado?: string;
};

/** `api/clubes/ajax_club_equipos.php?clave=&cod_temporada=` */
export type EquipoDeClubCrudo = {
  codequipo?: string;
  nombre_equipo?: string;
  categoria?: string;
  codigo_categoria?: string;
  codigo_club?: string;
  clave_acceso_club?: string;
  campo_juego?: string;
  codigo_campo?: string;
  jugar_dia?: string;
  jugar_horario?: string;
  en_competicion?: string;
};

/** `api/instalaciones/campos.php` (catálogo) y `datos_campo.php?codcampo=` (ficha). */
export type CampoCrudo = {
  codigo?: string;
  nombre?: string;
  nombre_campo?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  codigo_postal?: string;
};

// ── Vocabulario de MisterFC ──────────────────────────────────────────────────────────

/** Lo que el lector entrega de cada partido del calendario federado. */
export type PartidoFfcv = {
  /** `codacta`. La clave de idempotencia de F-2 (`events.ffcv_match_code`). */
  acta: string;
  /** La jornada, como número (`events.ffcv_round`). */
  jornada: number;
  /** Instante UTC en ISO, ya resuelto el huso y el horario de verano. */
  fechaHoraIso: string;
  /** true si jugamos en casa. Decide el ORDEN del título (local primero). */
  enCasa: boolean;
  /** Nombre del rival tal cual lo dice la FFCV, sin las comillas. */
  rival: string;
  /** Código del rival en la FFCV. */
  codigoRival: string;
  /** Nombre del campo. Siempre viene; la dirección es aparte y puede faltar. */
  campo: string;
  /** `estado === '1'`. El marcador NO se lee, a propósito. */
  jugado: boolean;
};

/** Dónde vive un equipo en la competición. Alimenta las tres columnas caché de F-1. */
export type UbicacionCompetitiva = {
  temporada: string;
  competicion: string;
  grupo: string;
  nombreCompeticion: string;
  nombreGrupo: string;
};

/** Una dirección de campo, ya compuesta para `events.location_address`. */
export type DireccionCampo = {
  nombre: string;
  direccion: string;
};
