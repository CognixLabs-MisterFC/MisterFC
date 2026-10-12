/**
 * F-3 · Dónde juega un equipo y cuál es su calendario.
 *
 * ── NO HAY ENDPOINT DE CALENDARIO POR EQUIPO ────────────────────────────────────────
 * El único de partidos es `resultados_por_grupo_jornada_data.php`, que da UNA jornada de
 * UN grupo. El calendario de un equipo son, por tanto, tantas llamadas como jornadas
 * tenga su grupo (26 en la liga del Infantil B), filtrando por CÓDIGO de equipo —que el
 * partido sí trae, en `cod_equipo_local` y `cod_equipo_visitante`—, nunca por nombre.
 *
 * ── Y TAMPOCO HAY BÚSQUEDA INVERSA EQUIPO → GRUPO ───────────────────────────────────
 * Hay que recorrer temporada → competiciones de su categoría → grupos, y mirar en cada
 * grupo si el equipo está. Para mirarlo se usa la CLASIFICACIÓN del grupo, no los
 * partidos de la jornada 1, por un motivo concreto: la clasificación lista los 14 equipos
 * del grupo con su `codequipo`, mientras que en los partidos de una jornada un equipo
 * puede no aparecer (descansa, si el grupo tiene un número impar de equipos). Hay un
 * respaldo por los partidos porque las competiciones traen un `visible_clasificacion` que
 * puede valer '0' y solo se midió el de una.
 *
 * Esto se paga UNA vez por equipo y temporada: su resultado son las tres columnas caché
 * de F-1 (`ffcv_competition_code`, `ffcv_group_code`, `ffcv_season_code`).
 *
 * ── FALLA CERRADO, Y ESO ES EL DISEÑO ───────────────────────────────────────────────
 * Si una sola jornada no se puede leer, `leerCalendarioDeEquipo` devuelve FALLO y no un
 * calendario de 25 partidos. Un calendario incompleto que se presenta como completo es
 * exactamente la mentira que F-3 existe para impedir: el partido que falta no se ve que
 * falta. Lo mismo con una fecha ilegible de un partido NUESTRO.
 */

import { pedirJson, type FfcvConfig, type FfcvResultado } from './client';
import { aIsoUtc } from './fecha';
import type {
  CompeticionCruda,
  GrupoCrudo,
  JornadaCruda,
  PartidoCrudo,
  PartidoFfcv,
  UbicacionCompetitiva,
  VerEquipoCrudo,
} from './types';

/** La FFCV escribe el equipo como `U.D. Fonteta 'B'`. Decisión de Jose: verbatim, sin las comillas. */
export function limpiarNombreEquipo(nombre: string): string {
  return nombre.replace(/['‘’]/g, '').replace(/\s+/g, ' ').trim();
}

/** La ficha del equipo. De aquí salen su categoría (para el barrido) y su campo propio. */
export async function leerFichaEquipo(
  codigoEquipo: string,
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<VerEquipoCrudo>> {
  return pedirJson<VerEquipoCrudo>(
    `api/equipos/ver_equipo.php?codequipo=${encodeURIComponent(codigoEquipo)}`,
    cfg,
    (d) =>
      d.codigo_equipo === codigoEquipo
        ? null
        : `se pidio el equipo ${codigoEquipo} y la ficha dice ${String(d.codigo_equipo)}`,
  );
}

type ClasificacionCruda = {
  codigo_grupo?: string;
  codigo_competicion?: string;
  competicion?: string;
  grupo?: string;
  clasificacion?: { codequipo?: string }[];
};

/** Los códigos de equipo de un grupo, por su clasificación. */
async function equiposDelGrupo(
  grupo: string,
  cfg: FfcvConfig,
): Promise<FfcvResultado<{ codigos: string[]; nombreCompeticion: string; nombreGrupo: string }>> {
  const r = await pedirJson<ClasificacionCruda>(
    `api/clasificaciones/clasificaciones_ajax.php?cod_grupo=${encodeURIComponent(grupo)}&cod_jornada=1`,
    cfg,
    // La clasificación hace ECO del grupo pedido: la defensa contra un filtro ignorado.
    (d) =>
      d.codigo_grupo === undefined || d.codigo_grupo === grupo
        ? null
        : `se pidio el grupo ${grupo} y la clasificacion es del ${String(d.codigo_grupo)}`,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    datos: {
      codigos: (r.datos.clasificacion ?? [])
        .map((f) => (f.codequipo ?? '').trim())
        .filter((c) => c.length > 0),
      nombreCompeticion: (r.datos.competicion ?? '').trim(),
      nombreGrupo: (r.datos.grupo ?? '').trim(),
    },
  };
}

/** Respaldo: los códigos que aparecen en los partidos de la jornada 1 del grupo. */
async function equiposPorPartidos(
  temporada: string,
  competicion: string,
  grupo: string,
  cfg: FfcvConfig,
): Promise<FfcvResultado<string[]>> {
  const r = await leerPartidosDeJornada({ temporada, competicion, grupo, jornada: '1' }, cfg);
  if (!r.ok) return r;
  const codigos = new Set<string>();
  for (const p of r.datos) {
    if (p.cod_equipo_local) codigos.add(p.cod_equipo_local);
    if (p.cod_equipo_visitante) codigos.add(p.cod_equipo_visitante);
  }
  return { ok: true, datos: [...codigos] };
}

/**
 * Localiza competición y grupo de un equipo dentro de una temporada.
 *
 * Caro a propósito: recorre las competiciones de SU categoría y barre sus grupos. Se
 * guarda en `teams` para no repetirlo.
 */
export async function resolverUbicacion(
  params: { temporada: string; codigoEquipo: string },
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<UbicacionCompetitiva>> {
  const { temporada, codigoEquipo } = params;

  const ficha = await leerFichaEquipo(codigoEquipo, cfg);
  if (!ficha.ok) return ficha;
  const codigoCategoria = (ficha.datos.codigo_categoria ?? '').trim();
  if (!codigoCategoria) {
    return {
      ok: false,
      fallo: { motivo: 'api', detalle: `el equipo ${codigoEquipo} no declara categoria` },
    };
  }

  const comps = await pedirJson<{ competiciones?: CompeticionCruda[] }>(
    `api/filtros/competiciones_fetch.php?cod_temporada=${encodeURIComponent(temporada)}`,
    cfg,
    (d) =>
      Array.isArray(d.competiciones) && d.competiciones.length > 0
        ? null
        : `la temporada ${temporada} no trae competiciones`,
  );
  if (!comps.ok) return comps;

  // Varias competiciones comparten categoría (Alacant / Castelló / València son tres
  // competiciones con el mismo `CodigoCategoria`), así que la categoría acota pero no
  // determina: hay que probarlas.
  const candidatas = (comps.datos.competiciones ?? []).filter(
    (c) => (c.CodigoCategoria ?? '').trim() === codigoCategoria && (c.codigo ?? '').trim() !== '',
  );
  if (candidatas.length === 0) {
    return {
      ok: false,
      fallo: {
        motivo: 'api',
        detalle: `ninguna competicion de la temporada ${temporada} tiene la categoria ${codigoCategoria}`,
      },
    };
  }

  for (const comp of candidatas) {
    const competicion = (comp.codigo ?? '').trim();
    const grupos = await pedirJson<{ grupos?: GrupoCrudo[] }>(
      `api/filtros/grupos_fetch.php?cod_competicion=${encodeURIComponent(competicion)}`,
      cfg,
      (d) => (Array.isArray(d.grupos) ? null : 'la competicion no trae `grupos`'),
    );
    if (!grupos.ok) return grupos;

    for (const g of grupos.datos.grupos ?? []) {
      const grupo = (g.codigo ?? '').trim();
      if (!grupo) continue;

      const clasif = await equiposDelGrupo(grupo, cfg);
      if (!clasif.ok) return clasif;

      let codigos = clasif.datos.codigos;
      if (codigos.length === 0) {
        // `visible_clasificacion` puede valer '0': se mira por los partidos.
        const porPartidos = await equiposPorPartidos(temporada, competicion, grupo, cfg);
        if (!porPartidos.ok) return porPartidos;
        codigos = porPartidos.datos;
      }

      if (codigos.includes(codigoEquipo)) {
        return {
          ok: true,
          datos: {
            temporada,
            competicion,
            grupo,
            nombreCompeticion: clasif.datos.nombreCompeticion || (comp.nombre ?? '').trim(),
            nombreGrupo: clasif.datos.nombreGrupo || (g.nombre ?? '').trim(),
          },
        };
      }
    }
  }

  return {
    ok: false,
    fallo: {
      motivo: 'api',
      detalle: `el equipo ${codigoEquipo} no aparece en ningun grupo de las ${candidatas.length} competiciones de su categoria`,
    },
  };
}

/** Las jornadas de un grupo. Un grupo sin jornadas no es un estado real: se trata como fallo. */
export async function leerJornadas(
  grupo: string,
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<JornadaCruda[]>> {
  const r = await pedirJson<{ jornadas?: JornadaCruda[] }>(
    `api/filtros/jornadas_fetch.php?cod_grupo=${encodeURIComponent(grupo)}`,
    cfg,
    (d) =>
      Array.isArray(d.jornadas) && d.jornadas.length > 0
        ? null
        : `el grupo ${grupo} no trae ninguna jornada: o no existe o el origen esta mintiendo`,
  );
  if (!r.ok) return r;
  return { ok: true, datos: r.datos.jornadas ?? [] };
}

/** Los partidos de una jornada de un grupo. */
export async function leerPartidosDeJornada(
  params: { temporada: string; competicion: string; grupo: string; jornada: string },
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<PartidoCrudo[]>> {
  const qs = new URLSearchParams({
    cod_temporada: params.temporada,
    cod_competicion: params.competicion,
    cod_grupo: params.grupo,
    cod_jornada: params.jornada,
  });
  const r = await pedirJson<{ jornada?: string; partidos?: PartidoCrudo[] }>(
    `api/partidos/resultados_por_grupo_jornada_data.php?${qs.toString()}`,
    cfg,
    // El payload hace ECO de la jornada pedida: la defensa contra un filtro ignorado.
    (d) => {
      if (!Array.isArray(d.partidos)) return 'la respuesta no trae `partidos`';
      if (d.jornada !== undefined && d.jornada !== params.jornada) {
        return `se pidio la jornada ${params.jornada} y vino la ${String(d.jornada)}`;
      }
      return null;
    },
  );
  if (!r.ok) return r;
  return { ok: true, datos: r.datos.partidos ?? [] };
}

/** Un partido crudo → el vocabulario de MisterFC, visto desde NUESTRO equipo. */
export function mapearPartido(
  crudo: PartidoCrudo,
  jornada: number,
  codigoEquipo: string,
): PartidoFfcv | null {
  const enCasa = crudo.cod_equipo_local === codigoEquipo;
  const fuera = crudo.cod_equipo_visitante === codigoEquipo;
  if (!enCasa && !fuera) return null;

  const acta = (crudo.codacta ?? '').trim();
  const fechaHoraIso = aIsoUtc(crudo.fecha ?? '', crudo.hora ?? '');
  const rivalCrudo = enCasa ? crudo.visitante : crudo.local;
  const codigoRival = (enCasa ? crudo.cod_equipo_visitante : crudo.cod_equipo_local) ?? '';
  if (!acta || !fechaHoraIso || !rivalCrudo) return null;

  return {
    acta,
    jornada,
    fechaHoraIso,
    enCasa,
    rival: limpiarNombreEquipo(rivalCrudo),
    codigoRival,
    campo: (crudo.campo ?? '').trim(),
    jugado: crudo.estado === '1',
  };
}

export type CalendarioFfcv = {
  partidos: PartidoFfcv[];
  /** Cuántas jornadas se leyeron. Un equipo puede no jugar en todas (descansos). */
  jornadasLeidas: number;
};

/**
 * El calendario completo de un equipo. FALLA CERRADO: si una jornada no se puede leer, o
 * si un partido NUESTRO trae una fecha ilegible, devuelve fallo en vez de un calendario
 * incompleto que nadie va a notar que lo está.
 */
export async function leerCalendarioDeEquipo(
  params: { temporada: string; competicion: string; grupo: string; codigoEquipo: string },
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<CalendarioFfcv>> {
  const { temporada, competicion, grupo, codigoEquipo } = params;
  const jornadas = await leerJornadas(grupo, cfg);
  if (!jornadas.ok) return jornadas;

  const partidos: PartidoFfcv[] = [];
  for (const j of jornadas.datos) {
    const codjornada = (j.codjornada ?? '').trim();
    if (!codjornada) continue;
    const r = await leerPartidosDeJornada({ temporada, competicion, grupo, jornada: codjornada }, cfg);
    if (!r.ok) return r;

    for (const crudo of r.datos) {
      const esNuestro =
        crudo.cod_equipo_local === codigoEquipo || crudo.cod_equipo_visitante === codigoEquipo;
      if (!esNuestro) continue;
      const p = mapearPartido(crudo, Number(codjornada), codigoEquipo);
      if (!p) {
        return {
          ok: false,
          fallo: {
            motivo: 'api',
            detalle: `partido ilegible en la jornada ${codjornada} (acta ${String(crudo.codacta)}, fecha ${String(crudo.fecha)} ${String(crudo.hora)})`,
          },
        };
      }
      partidos.push(p);
    }
  }

  return { ok: true, datos: { partidos, jornadasLeidas: jornadas.datos.length } };
}
