/**
 * El locale de la app traducido al que entiende `Intl`.
 *
 * ── EL FALLO ────────────────────────────────────────────────────────────────
 * `va` NO es un locale de Intl, y lo peor es que **no falla**: resuelve en silencio
 * a `en-US`. Medido:
 *
 *     new Intl.DateTimeFormat('va', {…}).format(d)  →  "September 10, 2026"
 *     new Intl.DateTimeFormat('va').resolvedOptions().locale  →  "en-US"
 *
 * O sea que quien tiene la web en valenciano lleva desde siempre leyendo las fechas en
 * INGLÉS y con el orden americano (`9/10/2026`), dentro de una pantalla en valenciano.
 * No hay excepción, no hay aviso y no hay nada en los logs. La app nativa no lo tiene
 * porque nunca usó Intl para esto: #589 le puso el catálogo.
 *
 * ── POR QUÉ `ca-ES-valencia` ────────────────────────────────────────────────
 * Es el tag BCP-47 del valenciano, y CLDR lo resuelve a los datos de `ca-ES`:
 * "dijous, 10 de setembre del 2026". El repo ya tenía este mapeo escrito TRES veces
 * (`calendar-utils`, `sesiones/page`, `jugadas/page`) apuntando a `ca-ES` a secas;
 * el resultado renderizado es idéntico hoy —`ca-ES-valencia` resuelve a `ca-ES`—, así
 * que unificar en el tag preciso no cambia un píxel y deja de mentir sobre qué idioma
 * es. Un runtime que no conozca la variante la descarta y se queda en `ca-ES`, que es
 * exactamente lo que queríamos: el algoritmo de lookup de BCP-47 recorta subtags.
 *
 * `en` → `en-GB` y no `en-US`, y tampoco es nuevo: viene de los mapeos que ya estaban.
 * El club está en España, y `10/09` tiene que querer decir lo mismo en las tres
 * versiones de la misma pantalla.
 *
 * ── DÓNDE SE USA ────────────────────────────────────────────────────────────
 * En TODO lo que reciba el locale de la app: `Intl.*`, `toLocaleDateString`,
 * `toLocaleString`, `toLocaleTimeString` y `localeCompare`. Hay un censo
 * (`pnpm check:intl-locale`) que se pone rojo si alguien vuelve a pasar el locale
 * crudo, porque el síntoma de olvidarlo no es un error: es una fecha en inglés que
 * solo ve quien tiene la app en valenciano.
 */
const MAPA: Record<string, string> = {
  es: 'es-ES',
  en: 'en-GB',
  va: 'ca-ES-valencia',
};

/**
 * Un locale desconocido se devuelve tal cual: si mañana entra un idioma nuevo, Intl
 * hará lo que sepa con él en vez de caer a un castellano que nadie ha pedido. Los tres
 * que existen hoy están en el mapa.
 */
export function intlLocale(locale: string): string {
  return MAPA[locale] ?? locale;
}
