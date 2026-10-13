/**
 * F-4 · El alta de los partidos federados como eventos de MisterFC.
 *
 * ── LAS CUATRO DECISIONES DE JOSE (2026-10-12), que definen esto ────────────────────
 *  1 · NO HAY AUTOMATISMO. Ni cron ni disparo por evento: estas funciones no se llaman
 *      solas. Alguien las invoca cuando toca. Por eso aquí no hay ni ruta ni agenda, y
 *      el cliente de Supabase lo trae el llamante (con él viene también el actor, y por
 *      tanto quién firma los eventos).
 *  2 · AISLAR POR EQUIPO. El fallo de un equipo no impide importar los otros catorce:
 *      el resumen dice, equipo por equipo, qué se creó y qué no.
 *  3 · SOLO CREA. Un partido que ya existe NO SE TOCA — ni la fecha, ni el título, ni el
 *      campo. Si algún día hace falta actualizar, se decide entonces.
 *  4 · Los códigos de competición y grupo NO los escribe esto: llegan ya en `teams`
 *      (F-1), puestos por una migración de datos. Un equipo que no los tenga se reporta
 *      como «sin ubicación» y se salta, sin intentar adivinarlos.
 *
 * ── POR QUÉ «SOLO CREA» SE IMPLEMENTA LEYENDO ANTES, Y NO CON UN UPSERT ────────────
 * Existe el único parcial `events_ffcv_match_code_team_uniq` (F-2), pero un
 * `on conflict (ffcv_match_code, team_id)` NO puede inferir un índice PARCIAL sin
 * repetir su predicado en la propia sentencia, y el cliente de Supabase no deja
 * escribirlo. Leer primero las actas que ya están y meter solo las que faltan es además
 * lo que dice la decisión 3 con más literalidad: no hay ninguna escritura sobre una fila
 * existente, ni siquiera una que «no cambie nada». El único sigue ahí como red: si una
 * carrera colara un duplicado, el 23505 se cuenta como «ya estaba» y no rompe la pasada.
 *
 * ── Y POR QUÉ SE INSERTA DE UNA EN UNA ──────────────────────────────────────────────
 * Porque un lote falla entero: un solo partido con algo raro dejaría los otros 25 sin
 * crear. Son 26 inserciones por equipo en una operación manual, no en un camino caliente,
 * y el aislamiento por partido es la decisión 2 un nivel más abajo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  descargarCatalogoCampos,
  direccionDeMapa,
  direccionesConCampoPropio,
  mapaDeDirecciones,
} from './campos';
import { describirFallo, type FfcvConfig, type FfcvFallo } from './client';
import { leerCalendarioDeEquipo } from './calendario';
import { CAMPO_MAX, RIVAL_MAX, TITULO_MAX, tituloDePartido } from './titulo';
import type { PartidoFfcv } from './types';

type Cliente = SupabaseClient<Database>;
type FilaEvento = Database['public']['Tables']['events']['Insert'];

/** La jornada tiene su propio CHECK: `ffcv_round between 1 and 200`. */
export const JORNADA_MIN = 1;
export const JORNADA_MAX = 200;

/** Un equipo de MisterFC listo para importar: con sus cuatro códigos de la FFCV. */
export type EquipoParaImportar = {
  teamId: string;
  clubId: string;
  /** El nombre en MisterFC («Infantil B»): el que va al título. */
  nombre: string;
  ffcvTeamCode: string;
  ffcvSeasonCode: string;
  ffcvCompetitionCode: string;
  ffcvGroupCode: string;
};

export type PartidoOmitido = { acta: string; motivo: string };

/** Un partido que ya existía y que la FFCV ha movido. `cambios` dice QUÉ se movió. */
export type PartidoCambiado = { acta: string; cambios: string[] };

/**
 * Las columnas del evento que son de la FFCV y por tanto se sobreescriben en el repaso.
 *
 * ── POR QUÉ ESTAS Y NO OTRAS ────────────────────────────────────────────────────────
 * La FFCV cambia día y hora cada semana. Con «solo crea», el calendario se quedaba con
 * la fecha vieja y las familias iban al partido equivocado — eso es el fallo que esto
 * arregla, y por eso la FFCV MANDA sobre estas seis.
 *
 * `title` y `opponent_name` entran aunque Jose solo pidiera «fecha, hora y campo»: el
 * título lleva el orden local-visitante, así que si un partido cambia de campo porque se
 * invierte la condición de local, un título sin actualizar DICE que jugamos en casa
 * cuando no. Dejarlo fuera sería dejar una mentira a medio camino.
 *
 * ── Y LO QUE NO SE TOCA NUNCA ───────────────────────────────────────────────────────
 * `notes` (lo que escribe el entrenador), `approval_status` y sus campos, los
 * `cancelled_*` (cancelar es de MisterFC, no de la federación), `created_by` y las otras
 * tablas: convocatoria y asistencia no se miran siquiera.
 *
 * ── LA CONSECUENCIA, DICHA EN VOZ ALTA ──────────────────────────────────────────────
 * Una corrección hecha a mano en la fecha, la hora o el campo SE PIERDE en el repaso
 * siguiente. Es lo que significa que la FFCV sea la fuente de verdad de esas columnas.
 */
export const COLUMNAS_DE_LA_FFCV = [
  'starts_at',
  'title',
  'location_name',
  'location_address',
  'opponent_name',
  'ffcv_round',
] as const;

export type ColumnaDeLaFfcv = (typeof COLUMNAS_DE_LA_FFCV)[number];

export type ResumenEquipo = {
  teamId: string;
  nombre: string;
  /** Partidos que la FFCV da para este equipo. */
  leidos: number;
  creados: number;
  /** Ya tenían su evento: no se tocan (decisión 3). */
  yaEstaban: number;
  omitidos: PartidoOmitido[];
  /** Los que ya existían y la FFCV ha movido. Es el repaso de los martes. */
  actualizados: PartidoCambiado[];
  /** Cuántos entraron con la hora de relleno porque la FFCV no la ha puesto todavía. */
  conHoraDeRelleno: number;
  /** Si el lector o la base fallaron del todo para ESTE equipo. */
  fallo: FfcvFallo | null;
};

export type DepsImportacion = {
  /** Quién firma los eventos (`events.created_by`). */
  actorProfileId: string;
  cfg?: FfcvConfig;
  /**
   * Resuelve la dirección de un campo por su nombre. Se inyecta ya resuelto para que el
   * catálogo de campos (2.216 filas, 23 páginas) se descargue UNA vez por pasada y no
   * una por equipo. Si devuelve null, el evento va con el nombre del campo y sin
   * dirección, que es lo acordado: la falta de dirección no tumba un partido.
   */
  direccionDe?: (nombreCampo: string) => string | null;
};

/**
 * Qué decir de la respuesta de un equipo: hecho, o roto y por qué.
 *
 * ── POR QUÉ ESTO VIVE AQUÍ Y NO EN LA PANTALLA ──────────────────────────────────────
 * Un fallo POR EQUIPO viaja con HTTP 200 y `ok: true`: es un resultado legítimo, porque
 * la ruta aísla por equipo a propósito (decisión 2). Así que quien solo mire el HTTP y
 * el sobre pinta ese equipo como HECHO con los contadores a cero, y eso se lee igual
 * que «no había nada que hacer».
 *
 * Eso es exactamente lo que pasó el 2026-10-13: el diálogo no miraba `resumen.fallo` y
 * Alevín C y Benjamín A —que no habían importado NADA— aparecieron al día. Era el peor
 * de los cuatro agujeros, porque esconde a los otros tres.
 *
 * Está en core, y no inline en el diálogo, para que se pueda MEDIR: `apps/web` no tiene
 * runner de tests y una decisión sin test es una decisión que vuelve a romperse.
 */
export type VeredictoEquipo<R> =
  | { ok: true; resumen: R }
  | { ok: false; clave: string; status?: number }
  | { ok: false; fallo: FfcvFallo };

export function veredictoDeEquipo<R extends { fallo: FfcvFallo | null }>(
  httpOk: boolean,
  cuerpo: { ok?: boolean; error?: string; resumen?: R | null },
): VeredictoEquipo<R> {
  if (!httpOk || cuerpo.ok !== true || !cuerpo.resumen) {
    return { ok: false, clave: cuerpo.error ?? 'ffcv' };
  }
  if (cuerpo.resumen.fallo !== null) return { ok: false, fallo: cuerpo.resumen.fallo };
  return { ok: true, resumen: cuerpo.resumen };
}

/**
 * El veredicto desde la respuesta CRUDA: el estado HTTP y el texto sin parsear.
 *
 * ── POR QUÉ NO VALE CON `res.json()` ────────────────────────────────────────────────
 * `await res.json()` LANZA cuando el cuerpo no es JSON, y en la pantalla eso caía en el
 * mismo `catch` que «no hay red», de modo que decía «comprueba la conexión» habiendo
 * conectado perfectamente. El 2026-10-13 eso ocultó el fallo de verdad en los cinco
 * últimos equipos de la serie: Vercel había matado la invocación por tiempo y devuelto
 * su página de error, que es HTML.
 *
 * Un cuerpo que no es JSON NO es un problema de red: es el servidor contestando otra
 * cosa, casi siempre porque la invocación se pasó de tiempo. Y el estado HTTP viaja en
 * el veredicto para que la pantalla pueda decir cuál fue.
 */
export function veredictoDeRespuesta<R extends { fallo: FfcvFallo | null }>(
  status: number,
  texto: string,
): VeredictoEquipo<R> {
  let cuerpo: { ok?: boolean; error?: string; resumen?: R | null };
  try {
    cuerpo = JSON.parse(texto) as { ok?: boolean; error?: string; resumen?: R | null };
  } catch {
    return { ok: false, clave: 'servidor', status };
  }
  if (cuerpo === null || typeof cuerpo !== 'object')
    return { ok: false, clave: 'servidor', status };
  return veredictoDeEquipo(status >= 200 && status < 300, cuerpo);
}

/** Valida contra los CHECK de la tabla ANTES de ir a la base. */
export function revisarPartido(
  nombreEquipo: string,
  partido: PartidoFfcv,
): { titulo: string } | { motivo: string } {
  const titulo = tituloDePartido(nombreEquipo, partido);
  if (titulo.length < 1 || titulo.length > TITULO_MAX) {
    return { motivo: `el titulo mide ${titulo.length} y el limite es ${TITULO_MAX}` };
  }
  if (partido.rival.length < 1 || partido.rival.length > RIVAL_MAX) {
    return { motivo: `el rival mide ${partido.rival.length} y el limite es ${RIVAL_MAX}` };
  }
  if (partido.campo.length > CAMPO_MAX) {
    return { motivo: `el campo mide ${partido.campo.length} y el limite es ${CAMPO_MAX}` };
  }
  if (partido.jornada < JORNADA_MIN || partido.jornada > JORNADA_MAX) {
    return { motivo: `la jornada ${partido.jornada} esta fuera de ${JORNADA_MIN}..${JORNADA_MAX}` };
  }
  if (!partido.fechaHoraIso) return { motivo: 'sin fecha' };
  return { titulo };
}

/** La fila que se inserta. Separada para poder afirmar sobre ella en los tests. */
export function filaDeEvento(
  equipo: EquipoParaImportar,
  partido: PartidoFfcv,
  titulo: string,
  actorProfileId: string,
  direccion: string | null,
): FilaEvento {
  return {
    club_id: equipo.clubId,
    team_id: equipo.teamId,
    type: 'match',
    title: titulo,
    starts_at: partido.fechaHoraIso,
    ends_at: null,
    all_day: false,
    location_name: partido.campo || null,
    location_address: direccion,
    opponent_name: partido.rival,
    notes: null,
    created_by: actorProfileId,
    ffcv_match_code: partido.acta,
    ffcv_round: partido.jornada,
  };
}

/** Las actas que este equipo ya tiene en su calendario. */
/** Lo que ya hay en la base para este equipo, indexado por acta y CON sus valores. */
export type EventoExistente = {
  id: string;
  starts_at: string;
  title: string;
  location_name: string | null;
  location_address: string | null;
  opponent_name: string | null;
  ffcv_round: number | null;
};

async function partidosYaPuestos(
  cliente: Cliente,
  teamId: string,
): Promise<{ ok: true; porActa: Map<string, EventoExistente> } | { ok: false; detalle: string }> {
  // Se leen los VALORES, no solo las actas: sin ellos no se puede saber qué ha movido la
  // FFCV, y un repaso que no compara tendría que reescribir las 290 filas cada martes.
  const { data, error } = await cliente
    .from('events')
    .select(
      'id, ffcv_match_code, starts_at, title, location_name, location_address, opponent_name, ffcv_round',
    )
    .eq('team_id', teamId)
    .not('ffcv_match_code', 'is', null);
  if (error) return { ok: false, detalle: String(error.message ?? error) };
  const porActa = new Map<string, EventoExistente>();
  for (const f of data ?? []) {
    if (!f.ffcv_match_code) continue;
    porActa.set(f.ffcv_match_code, {
      id: f.id,
      starts_at: f.starts_at,
      title: f.title,
      location_name: f.location_name,
      location_address: f.location_address,
      opponent_name: f.opponent_name,
      ffcv_round: f.ffcv_round,
    });
  }
  return { ok: true, porActa };
}

/**
 * Qué columnas de la FFCV han cambiado. Pura y exportada: es el corazón del repaso y
 * tiene que poder probarse sin red ni base.
 *
 * `starts_at` se compara como INSTANTE, no como texto. La base devuelve
 * `2026-10-18T08:30:00+00:00` y nosotros construimos `2026-10-18T08:30:00.000Z`: son el
 * mismo momento y dos cadenas distintas. Compararlas como texto marcaría los 290
 * partidos como cambiados todos los martes y reescribiría la tabla entera para nada.
 */
export function cambiosDelPartido(
  existente: EventoExistente,
  deseada: Pick<
    FilaEvento,
    'starts_at' | 'title' | 'location_name' | 'location_address' | 'opponent_name' | 'ffcv_round'
  >,
): string[] {
  const cambios: string[] = [];
  const antes = new Date(existente.starts_at).getTime();
  const ahora = new Date(deseada.starts_at).getTime();
  if (!Number.isFinite(antes) || !Number.isFinite(ahora) || antes !== ahora) cambios.push('fecha');
  if (existente.title !== deseada.title) cambios.push('titulo');
  if ((existente.location_name ?? null) !== (deseada.location_name ?? null)) cambios.push('campo');
  if ((existente.location_address ?? null) !== (deseada.location_address ?? null)) {
    cambios.push('direccion');
  }
  if ((existente.opponent_name ?? null) !== (deseada.opponent_name ?? null)) cambios.push('rival');
  if ((existente.ffcv_round ?? null) !== (deseada.ffcv_round ?? null)) cambios.push('jornada');
  return cambios;
}

/** Importa el calendario de UN equipo. Nunca lanza: el fallo va en el resumen. */
export async function importarCalendarioDeEquipoFromClient(
  cliente: Cliente,
  equipo: EquipoParaImportar,
  deps: DepsImportacion,
): Promise<ResumenEquipo> {
  const resumen: ResumenEquipo = {
    teamId: equipo.teamId,
    nombre: equipo.nombre,
    leidos: 0,
    creados: 0,
    yaEstaban: 0,
    omitidos: [],
    actualizados: [],
    conHoraDeRelleno: 0,
    fallo: null,
  };

  const yaPuestos = await partidosYaPuestos(cliente, equipo.teamId);
  if (!yaPuestos.ok) {
    // Una lectura muda aquí haría creer que no hay nada y duplicaría los 26 partidos.
    resumen.fallo = { motivo: 'api', detalle: `lectura de events: ${yaPuestos.detalle}` };
    return resumen;
  }

  const calendario = await leerCalendarioDeEquipo(
    {
      temporada: equipo.ffcvSeasonCode,
      competicion: equipo.ffcvCompetitionCode,
      grupo: equipo.ffcvGroupCode,
      codigoEquipo: equipo.ffcvTeamCode,
    },
    deps.cfg,
  );
  if (!calendario.ok) {
    resumen.fallo = calendario.fallo;
    return resumen;
  }

  resumen.leidos = calendario.datos.partidos.length;

  for (const partido of calendario.datos.partidos) {
    if (partido.horaDeRelleno) resumen.conHoraDeRelleno += 1;

    const revision = revisarPartido(equipo.nombre, partido);
    if ('motivo' in revision) {
      resumen.omitidos.push({ acta: partido.acta, motivo: revision.motivo });
      continue;
    }
    const direccion = deps.direccionDe ? deps.direccionDe(partido.campo) : null;
    const fila = filaDeEvento(equipo, partido, revision.titulo, deps.actorProfileId, direccion);

    // ── EL REPASO ───────────────────────────────────────────────────────────────────
    // Si ya existe, la FFCV manda sobre SUS columnas y nada más. Se comparan primero
    // para no reescribir 290 filas cada martes cuando no ha cambiado nada.
    const existente = yaPuestos.porActa.get(partido.acta);
    if (existente) {
      const cambios = cambiosDelPartido(existente, fila);
      if (cambios.length === 0) {
        resumen.yaEstaban += 1;
        continue;
      }
      // `Pick` ata el parche a COLUMNAS_DE_LA_FFCV: si alguien añade una columna a la
      // lista y se olvida de ponerla aquí, el typecheck lo para. Y si pone una que no
      // está en la lista, también.
      const parche: Pick<FilaEvento, ColumnaDeLaFfcv> = {
        starts_at: fila.starts_at,
        title: fila.title,
        location_name: fila.location_name,
        location_address: fila.location_address,
        opponent_name: fila.opponent_name,
        ffcv_round: fila.ffcv_round,
      };
      const { error: errorUpdate } = await cliente
        .from('events')
        .update(parche)
        .eq('id', existente.id);
      if (errorUpdate) {
        resumen.omitidos.push({
          acta: partido.acta,
          motivo: String(errorUpdate.message ?? errorUpdate),
        });
        continue;
      }
      resumen.actualizados.push({ acta: partido.acta, cambios });
      continue;
    }

    const { error } = await cliente.from('events').insert(fila);
    if (error) {
      const codigo = (error as { code?: string }).code;
      if (codigo === '23505') {
        // El único de F-2 ha mordido: alguien lo creó entre la lectura y ahora.
        resumen.yaEstaban += 1;
      } else {
        resumen.omitidos.push({ acta: partido.acta, motivo: String(error.message ?? error) });
      }
      continue;
    }
    resumen.creados += 1;
  }

  return resumen;
}

export type EquiposDelClub = {
  importables: EquipoParaImportar[];
  /** Vinculados pero sin competición o sin grupo: se saltan, no se adivinan. */
  sinUbicacion: { teamId: string; nombre: string; ffcvTeamCode: string }[];
  /** Sin `ffcv_team_code`: no están vinculados con la FFCV. */
  sinVincular: { teamId: string; nombre: string }[];
};

/** Qué equipos de un club y temporada se pueden importar hoy. */
export async function leerEquiposDelClubFromClient(
  cliente: Cliente,
  params: { clubId: string; season: string },
): Promise<{ ok: true; datos: EquiposDelClub } | { ok: false; detalle: string }> {
  const { data, error } = await cliente
    .from('teams')
    .select(
      'id, name, club_id, ffcv_team_code, ffcv_season_code, ffcv_competition_code, ffcv_group_code',
    )
    .eq('club_id', params.clubId)
    .eq('season', params.season)
    .order('name');
  if (error) return { ok: false, detalle: String(error.message ?? error) };

  const datos: EquiposDelClub = { importables: [], sinUbicacion: [], sinVincular: [] };
  for (const t of data ?? []) {
    if (!t.ffcv_team_code) {
      datos.sinVincular.push({ teamId: t.id, nombre: t.name });
      continue;
    }
    if (!t.ffcv_season_code || !t.ffcv_competition_code || !t.ffcv_group_code) {
      datos.sinUbicacion.push({
        teamId: t.id,
        nombre: t.name,
        ffcvTeamCode: t.ffcv_team_code,
      });
      continue;
    }
    datos.importables.push({
      teamId: t.id,
      clubId: t.club_id,
      nombre: t.name,
      ffcvTeamCode: t.ffcv_team_code,
      ffcvSeasonCode: t.ffcv_season_code,
      ffcvCompetitionCode: t.ffcv_competition_code,
      ffcvGroupCode: t.ffcv_group_code,
    });
  }
  return { ok: true, datos };
}

/**
 * Importa varios equipos, AISLADOS entre sí (decisión 2): el fallo de uno no impide los
 * demás, y el resumen lo dice equipo por equipo.
 */
export async function importarCalendariosFromClient(
  cliente: Cliente,
  equipos: EquipoParaImportar[],
  deps: DepsImportacion,
): Promise<ResumenEquipo[]> {
  const resumenes: ResumenEquipo[] = [];
  for (const equipo of equipos) {
    resumenes.push(await importarCalendarioDeEquipoFromClient(cliente, equipo, deps));
  }
  return resumenes;
}

/**
 * EL PRIMER VIAJE DEL BOTÓN: qué equipos hay y el mapa de direcciones.
 *
 * Se separa del alta de cada equipo porque el catálogo de campos son 23 páginas y no debe
 * descargarse una vez por equipo: se descarga aquí, viaja al navegador y el navegador lo
 * devuelve en cada viaje. 23 llamadas una vez, en lugar de 345.
 */
export type PreparacionFfcv = EquiposDelClub & {
  /** nombre exacto del campo → dirección, listo para `events.location_address`. */
  direcciones: Record<string, string>;
};

export async function prepararImportacionFromClient(
  cliente: Cliente,
  params: { clubId: string; season: string },
  cfg: FfcvConfig = {},
): Promise<{ ok: true; datos: PreparacionFfcv } | { ok: false; detalle: string }> {
  const equipos = await leerEquiposDelClubFromClient(cliente, params);
  if (!equipos.ok) return equipos;

  const catalogo = await descargarCatalogoCampos(cfg);
  if (!catalogo.ok) {
    // El catálogo falla CERRADO: medio catálogo convertido en «esta direccion no existe»
    // es la misma mentira silenciosa que el 200 con lista vacía.
    return { ok: false, detalle: `catalogo de campos: ${describirFallo(catalogo.fallo)}` };
  }

  return {
    ok: true,
    datos: { ...equipos.datos, direcciones: mapaDeDirecciones(catalogo.datos) },
  };
}

/**
 * UN VIAJE DEL BOTÓN: los partidos de UN equipo.
 *
 * Añade el campo propio al mapa antes de importar, porque el catálogo NO lo trae (medido:
 * sin esto, 15 de los 26 partidos del Infantil B se quedaban sin dirección; con esto,
 * uno). Si el campo propio no se resuelve, sigue adelante: la falta de una dirección no
 * tumba un partido.
 */
export async function importarEquipoConDireccionesFromClient(
  cliente: Cliente,
  params: {
    equipo: EquipoParaImportar;
    direcciones: Readonly<Record<string, string>>;
    actorProfileId: string;
  },
  cfg: FfcvConfig = {},
): Promise<ResumenEquipo> {
  const { direcciones } = await direccionesConCampoPropio(
    params.equipo.ffcvTeamCode,
    params.direcciones,
    cfg,
  );
  return importarCalendarioDeEquipoFromClient(cliente, params.equipo, {
    actorProfileId: params.actorProfileId,
    cfg,
    direccionDe: (nombre) => direccionDeMapa(nombre, direcciones),
  });
}
