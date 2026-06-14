/**
 * Formatea el nombre completo de un jugador para mostrar en listados,
 * tablas y cabeceras. last_name puede ser NULL per F2.9 hotfix
 * 2026-05-30: en ese caso devuelve solo el nombre, sin "null", sin
 * comas colgantes ni doble espacio.
 *
 *   formatPlayerName('Pepe', 'Gómez')  →  'Gómez, Pepe'
 *   formatPlayerName('Pepe', null)     →  'Pepe'
 *   formatPlayerName('Pepe', '   ')    →  'Pepe'
 */
export function formatPlayerName(
  first: string,
  last: string | null | undefined
): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (l.length === 0) return f;
  return `${l}, ${f}`;
}

/**
 * Nombre en orden natural "Nombre Apellido", para fichas donde se prioriza la
 * lectura humana sobre el orden de listado (p.ej. el chip de la alineación).
 * A diferencia de formatPlayerName (orden de listado "Apellido, Nombre").
 * last_name puede ser NULL (F2.9 hotfix): maneja huecos devolviendo el que haya,
 * sin espacios sobrantes ni "null".
 *
 *   formatPlayerNameNatural('Pepe', 'Gómez')  →  'Pepe Gómez'
 *   formatPlayerNameNatural('Pepe', null)     →  'Pepe'
 *   formatPlayerNameNatural('', 'Gómez')      →  'Gómez'
 *   formatPlayerNameNatural('Pepe', '   ')    →  'Pepe'
 */
export function formatPlayerNameNatural(
  first: string | null | undefined,
  last: string | null | undefined
): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  return [f, l].filter(Boolean).join(' ');
}

/**
 * Iniciales para avatar. Si no hay apellido, usa solo la del nombre.
 */
export function playerInitials(
  first: string,
  last: string | null | undefined
): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const a = f.charAt(0).toUpperCase();
  const b = l.charAt(0).toUpperCase();
  if (!b) return a || '?';
  return `${b}${a}`.slice(0, 2);
}

/**
 * Iniciales para el placeholder del avatar del jugador (Mejora I), en orden
 * NOMBRE + APELLIDO: avatarInitials('Pedro', 'Sánchez') → 'PS'. Si no hay datos
 * devuelve '·'. (Distinto de playerInitials, que va apellido-primero como los
 * listados.)
 */
export function avatarInitials(
  first: string | null | undefined,
  last: string | null | undefined
): string {
  const a = (first ?? '').trim().charAt(0).toUpperCase();
  const b = (last ?? '').trim().charAt(0).toUpperCase();
  const s = `${a}${b}`;
  return s.length > 0 ? s : '·';
}
