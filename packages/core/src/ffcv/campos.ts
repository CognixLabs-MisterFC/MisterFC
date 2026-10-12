/**
 * F-3 · La dirección del campo, que es *best-effort* a propósito.
 *
 * El partido trae el NOMBRE del campo pero no su código, y la dirección vive en el
 * catálogo o en la ficha del campo. Medido el 2026-10-12:
 *
 *  · `api/instalaciones/campos.php` IGNORA el filtro `nombre`: con filtro y sin él
 *    devuelve lo mismo (2.216 registros, 23 páginas de 100). Así que no se filtra: se
 *    descarga el catálogo una vez y se casa por nombre exacto en local.
 *  · De los 13 campos distintos del calendario del Infantil B, el catálogo resolvió 11.
 *    Los dos que no: «Campo La Malvarrosa F-11», que no está, y —esto importa— NUESTRO
 *    PROPIO «Polideportivo Mpal. Quatre Carreres F-11», que tampoco (el catálogo tiene su
 *    F-5, sus dos F-8 y un «Les Abelles F-11», pero no ese). O sea que el catálogo está
 *    INCOMPLETO respecto a `datos_campo.php`.
 *  · Para el campo propio da igual: la ficha del equipo (`ver_equipo`) trae su
 *    `codigo_campo`, y con él `datos_campo.php?codcampo=` sí lo devuelve, con dirección,
 *    localidad, provincia, código postal y hasta latitud y longitud.
 *
 * De ahí la regla: el NOMBRE del campo entra siempre en el evento; la DIRECCIÓN entra
 * cuando se resuelve y queda NULL cuando no. Que falte una dirección no debe tumbar la
 * importación de un partido — la familia tiene el nombre del campo, que es lo que había
 * antes de todo esto.
 */

import { leerFichaEquipo } from './calendario';
import { pedirJson, type FfcvConfig, type FfcvFallo, type FfcvResultado } from './client';
import type { CampoCrudo, DireccionCampo } from './types';

/** La página del catálogo sale de 100 aunque se pidan 200: el servidor topa ahí. */
export const FFCV_CAMPOS_POR_PAGINA = 100;
/** Tope de páginas, por si `total_paginas` viniera disparatado. */
export const FFCV_CAMPOS_MAX_PAGINAS = 60;

type CatalogoCrudo = {
  campos?: CampoCrudo[];
  total_paginas?: string;
  total_registros?: string;
};

/** Compone la dirección para `events.location_address` (máx. 240; la peor medida: 56). */
export function componerDireccion(c: CampoCrudo): string | null {
  const calle = (c.direccion ?? '').trim();
  const cp = (c.codigo_postal ?? '').trim();
  const localidad = (c.localidad ?? '').trim();
  const provincia = (c.provincia ?? '').trim();
  if (!calle && !localidad) return null;
  const cabeza = [calle, [cp, localidad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const texto = provincia && provincia !== localidad ? `${cabeza} (${provincia})` : cabeza;
  return texto.slice(0, 240) || null;
}

/**
 * Descarga el catálogo entero y lo indexa por nombre exacto.
 *
 * Si una página falla, se devuelve el fallo y NO un catálogo a medias: un catálogo
 * incompleto convertido en «esta dirección no existe» es la misma mentira silenciosa
 * que el 200 con lista vacía.
 */
export async function descargarCatalogoCampos(
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<Map<string, CampoCrudo>>> {
  const indice = new Map<string, CampoCrudo>();
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await pedirJson<CatalogoCrudo>(
      `api/instalaciones/campos.php?NPcd_PageLines=${FFCV_CAMPOS_POR_PAGINA}&NPcd_Page=${pagina}`,
      cfg,
      (d) => (Array.isArray(d.campos) ? null : 'el catalogo de campos no trae `campos`'),
    );
    if (!r.ok) return r;
    for (const c of r.datos.campos ?? []) {
      const nombre = (c.nombre ?? c.nombre_campo ?? '').trim();
      if (nombre && !indice.has(nombre)) indice.set(nombre, c);
    }
    totalPaginas = Math.min(Number(r.datos.total_paginas ?? '1') || 1, FFCV_CAMPOS_MAX_PAGINAS);
    pagina += 1;
  } while (pagina <= totalPaginas);
  return { ok: true, datos: indice };
}

/** Busca por nombre EXACTO en el catálogo ya descargado. null si no está. */
export function direccionEnCatalogo(
  nombreCampo: string,
  catalogo: Map<string, CampoCrudo>,
): DireccionCampo | null {
  const nombre = nombreCampo.trim();
  const c = catalogo.get(nombre);
  if (!c) return null;
  const direccion = componerDireccion(c);
  return direccion ? { nombre, direccion } : null;
}

/**
 * El catálogo reducido a lo que de verdad hace falta: nombre exacto → dirección.
 *
 * Existe porque el catálogo entero son 2.213 filas con todos sus campos y este mapa son
 * 214 KB (medido), que es lo que puede viajar entre el servidor y el navegador sin que la
 * importación tenga que descargar las 23 páginas una vez por equipo.
 */
export function mapaDeDirecciones(catalogo: Map<string, CampoCrudo>): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [nombre, campo] of catalogo) {
    const direccion = componerDireccion(campo);
    if (direccion !== null) mapa[nombre] = direccion;
  }
  return mapa;
}

/** Busca en el mapa ya compuesto. Mismo criterio que el catálogo: nombre EXACTO, trimado. */
export function direccionDeMapa(
  nombreCampo: string,
  mapa: Readonly<Record<string, string>>,
): string | null {
  return mapa[nombreCampo.trim()] ?? null;
}

/** La ficha de un campo por su código: la vía del campo PROPIO, que no está en el catálogo. */
export async function leerDatosCampo(
  codcampo: string,
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<DireccionCampo | null>> {
  const r = await pedirJson<CampoCrudo>(
    `api/instalaciones/datos_campo.php?codcampo=${encodeURIComponent(codcampo)}`,
    cfg,
  );
  if (!r.ok) return r;
  const nombre = (r.datos.nombre_campo ?? r.datos.nombre ?? '').trim();
  const direccion = componerDireccion(r.datos);
  return { ok: true, datos: nombre && direccion ? { nombre, direccion } : null };
}

/**
 * La dirección del campo PROPIO de un equipo. Dos llamadas: su ficha trae el
 * `codigo_campo`, y con ese código `datos_campo.php` sí devuelve la dirección.
 *
 * ── POR QUÉ ESTAS DOS LLAMADAS VALEN LA PENA ────────────────────────────────────────
 * Medido el 2026-10-12 sobre el calendario REAL del Infantil B: de sus 26 partidos, el
 * catálogo resolvía la dirección de 11. Los 15 restantes son los 13 de casa, UNO de
 * fuera que también se juega en nuestro campo, y «Campo La Malvarrosa F-11». Resolver el
 * campo propio por código y meter ese par (nombre → dirección) en el mismo mapa sube la
 * cobertura de 11 a 25 de 26 — porque el nombre es el mismo y cubre de paso el de fuera
 * que se juega allí.
 *
 * Devuelve `null`, no fallo, cuando el equipo no declara campo: es un estado real de la
 * FFCV y no debe tumbar una importación. Un fallo de red sí se propaga.
 */
export async function direccionDelCampoPropio(
  codigoEquipo: string,
  cfg: FfcvConfig = {},
): Promise<FfcvResultado<DireccionCampo | null>> {
  const ficha = await leerFichaEquipo(codigoEquipo, cfg);
  if (!ficha.ok) return ficha;
  const codigo = (ficha.datos.codigo_campo ?? '').trim();
  if (!codigo) return { ok: true, datos: null };
  return leerDatosCampo(codigo, cfg);
}

/**
 * El mapa de direcciones con el campo propio del equipo añadido.
 *
 * Si el campo propio no se puede resolver, devuelve el mapa TAL CUAL en vez de fallar: la
 * falta de una dirección no tumba una importación (es la regla de la cabecera), y el
 * nombre del campo entra en el evento de todas formas. El fallo se devuelve aparte para
 * que quien llame pueda contarlo sin tener que decidir si aborta.
 */
export async function direccionesConCampoPropio(
  codigoEquipo: string,
  mapa: Readonly<Record<string, string>>,
  cfg: FfcvConfig = {},
): Promise<{ direcciones: Record<string, string>; fallo: FfcvFallo | null }> {
  const propio = await direccionDelCampoPropio(codigoEquipo, cfg);
  if (!propio.ok) return { direcciones: { ...mapa }, fallo: propio.fallo };
  if (propio.datos === null) return { direcciones: { ...mapa }, fallo: null };
  return {
    direcciones: { ...mapa, [propio.datos.nombre]: propio.datos.direccion },
    fallo: null,
  };
}
