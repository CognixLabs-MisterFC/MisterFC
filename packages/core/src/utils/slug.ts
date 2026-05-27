/**
 * Convierte un nombre humano a un slug seguro para URL.
 *
 * Reglas (deben coincidir con el CHECK del schema de clubs):
 * - Solo a-z, 0-9, y guiones.
 * - No empieza ni termina en guión.
 * - Longitud máxima 63 chars.
 *
 * Si el resultado queda vacío (input solo símbolos), devuelve cadena vacía
 * para que el caller pueda decidir qué hacer (ej. añadir un UUID corto).
 */
export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
