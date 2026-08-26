/**
 * Normaliza texto para BÚSQUEDA: minúsculas + SIN acentos (NFD y elimina los
 * diacríticos combinantes U+0300–U+036F). Debe aplicarse tanto al término buscado
 * como al texto sobre el que se busca, para que la coincidencia valga en ambos
 * sentidos: "jose" encuentra "José" y "José" encuentra "jose". En un club español,
 * donde media plantilla lleva tildes, una búsqueda sensible a acentos es casi inútil.
 * Mismo patrón anti-acentos que utils/slug.
 *
 * Movida desde apps/native (`ui/directory-filters`) a core para reusarla también en
 * la web (Miembros del club · Familias). Comportamiento IDÉNTICO al original nativo:
 * la app la sigue consumiendo por re-exportación, sin cambio de resultado.
 */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
