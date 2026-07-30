import type { Role } from '@misterfc/core';

/**
 * O2-2 — Config de NAVEGACIÓN por área (la carcasa). Fuente única de verdad de
 * qué va en la BARRA INFERIOR y qué en el MENÚ HAMBURGUESA de cada rol. Los
 * _layout de cada área y el overlay del menú se construyen desde aquí; así el
 * modelo de producto vive en un solo sitio y no se reinterpreta por pantalla.
 *
 * TODAS las pantallas son placeholders en este PR (solo muestran su nombre).
 */

/**
 * Área de carcasa. Igual que `NavArea` de core (family/staff/direction) MÁS
 * 'spectator', que no es un rol de club y tiene barra propia.
 */
export type ChromeArea = 'family' | 'staff' | 'direction' | 'spectator';

/** Entrada de la BARRA inferior. `name` = fichero de ruta dentro de la carpeta del área. */
export type TabDef = { name: string; labelKey: string; icon: string };
/** Entrada del MENÚ hamburguesa (ruta oculta de la barra, href:null). */
export type MenuDef = { name: string; labelKey: string };

/** Carpeta (segmento de URL) de cada área bajo `app/`. */
export const AREA_SEGMENT: Record<ChromeArea, string> = {
  family: 'family',
  staff: 'staff',
  direction: 'direction',
  spectator: 'spectator',
};

/** Barras inferiores — literal y en orden (ver ADR-0020, Decisión 7). */
export const AREA_TABS: Record<ChromeArea, TabDef[]> = {
  // Jugador / familia (4)
  family: [
    { name: 'index', labelKey: 'nav.inicio', icon: '🏠' },
    { name: 'calendario', labelKey: 'nav.calendario', icon: '📅' },
    { name: 'directos', labelKey: 'nav.directos', icon: '🔴' },
    { name: 'mensajes', labelKey: 'nav.mensajes', icon: '💬' },
  ],
  // Cuerpo técnico (5) — principal ≡ ayudante ≡ delegado ≡ coordinador (misma barra)
  staff: [
    { name: 'index', labelKey: 'nav.inicio', icon: '🏠' },
    { name: 'equipo', labelKey: 'nav.equipo', icon: '👥' },
    { name: 'calendario', labelKey: 'nav.calendario', icon: '📅' },
    { name: 'directos', labelKey: 'nav.directos', icon: '🔴' },
    { name: 'mensajes', labelKey: 'nav.mensajes', icon: '💬' },
  ],
  // Dirección (4) — admin_club · director
  direction: [
    { name: 'index', labelKey: 'nav.inicio', icon: '🏠' },
    { name: 'equipos', labelKey: 'nav.equipos', icon: '🛡️' },
    { name: 'directos', labelKey: 'nav.directos', icon: '🔴' },
    { name: 'mensajes', labelKey: 'nav.mensajes', icon: '💬' },
  ],
  // Seguidor (4) — carcasa propia
  spectator: [
    { name: 'index', labelKey: 'nav.agenda', icon: '📅' },
    { name: 'directos', labelKey: 'nav.directos', icon: '🔴' },
    { name: 'estadisticas', labelKey: 'nav.estadisticas', icon: '📊' },
    { name: 'perfil', labelKey: 'nav.perfil', icon: '👤' },
  ],
};

const FAMILY_MENU: MenuDef[] = [
  { name: 'mi-equipo', labelKey: 'nav.mi_equipo' },
  { name: 'convocatorias', labelKey: 'nav.convocatorias' },
  { name: 'mi-ficha', labelKey: 'nav.mi_ficha' },
  { name: 'mi-informe', labelKey: 'nav.mi_informe' },
  { name: 'seguidores', labelKey: 'nav.seguidores' },
  { name: 'anuncios', labelKey: 'nav.anuncios' },
  { name: 'novedades', labelKey: 'nav.novedades' },
  { name: 'perfil', labelKey: 'nav.perfil' },
  { name: 'asistencia', labelKey: 'nav.asistencia_consulta' },
];

const STAFF_MENU_BASE: MenuDef[] = [
  { name: 'mis-equipos', labelKey: 'nav.mis_equipos' },
  { name: 'convocatorias', labelKey: 'nav.convocatorias' },
  { name: 'alineacion', labelKey: 'nav.alineacion' },
  { name: 'directo', labelKey: 'nav.directo' },
  { name: 'entrada-rapida', labelKey: 'nav.entrada_rapida' },
  { name: 'post-partido', labelKey: 'nav.post_partido' },
  { name: 'asistencia', labelKey: 'nav.asistencia' },
  { name: 'estadisticas-equipo', labelKey: 'nav.estadisticas_equipo' },
  { name: 'sesion-del-dia', labelKey: 'nav.sesion_del_dia' },
  { name: 'cuerpo-tecnico-ligero', labelKey: 'nav.cuerpo_tecnico_ligero' },
  { name: 'anuncios', labelKey: 'nav.anuncios' },
  { name: 'novedades', labelKey: 'nav.novedades' },
  { name: 'perfil', labelKey: 'nav.perfil' },
];

/** Extra SOLO del coordinador (por encima del menú de cuerpo técnico). */
const STAFF_MENU_COORD_EXTRA: MenuDef[] = [
  { name: 'cuerpo-tecnico-direccion', labelKey: 'nav.cuerpo_tecnico_direccion' },
  { name: 'jugadores-consulta', labelKey: 'nav.jugadores_consulta' },
];

const DIRECTION_MENU: MenuDef[] = [
  { name: 'inicio-direccion', labelKey: 'nav.inicio_direccion' },
  { name: 'dashboard', labelKey: 'nav.dashboard' },
  { name: 'calendario', labelKey: 'nav.calendario' },
  { name: 'jugadores', labelKey: 'nav.jugadores' },
  { name: 'cuerpo-tecnico', labelKey: 'nav.cuerpo_tecnico' },
  { name: 'supresiones', labelKey: 'nav.supresiones' },
  { name: 'anuncios', labelKey: 'nav.anuncios' },
  { name: 'novedades', labelKey: 'nav.novedades' },
  { name: 'perfil', labelKey: 'nav.perfil' },
];

/** Pantallas SOLO-menú por área (sin contar el extra dinámico del coordinador). */
export const AREA_MENU: Record<ChromeArea, MenuDef[]> = {
  family: FAMILY_MENU,
  staff: STAFF_MENU_BASE,
  direction: DIRECTION_MENU,
  spectator: [],
};

/**
 * Menú efectivo del área para un rol dado. El coordinador (área 'staff') añade
 * sus extras de coordinación; el resto usa el menú base del área.
 */
export function menuForArea(area: ChromeArea, role: Role | null): MenuDef[] {
  if (area === 'staff' && role === 'coordinador') {
    return [...STAFF_MENU_BASE, ...STAFF_MENU_COORD_EXTRA];
  }
  return AREA_MENU[area];
}

/**
 * TODOS los ficheros de pantalla solo-menú del área (incluye los extras del
 * coordinador en 'staff'). El _layout debe declararlos como `href:null`: un
 * fichero de ruta NO declarado aparecería como pestaña de la barra. El overlay,
 * en cambio, usa `menuForArea` (filtra por rol qué se LISTA).
 */
export function allMenuFiles(area: ChromeArea): MenuDef[] {
  if (area === 'staff') return [...STAFF_MENU_BASE, ...STAFF_MENU_COORD_EXTRA];
  return AREA_MENU[area];
}

/** Ruta absoluta de una pantalla del área (los grupos son carpetas reales). */
export function hrefFor(area: ChromeArea, name: string): string {
  const seg = AREA_SEGMENT[area];
  return name === 'index' ? `/${seg}` : `/${seg}/${name}`;
}
