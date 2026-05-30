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
