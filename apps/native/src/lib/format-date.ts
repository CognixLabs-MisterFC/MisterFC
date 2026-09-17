/**
 * Fechas con NOMBRES (día de la semana y mes) en el idioma de la APP.
 *
 * `toLocaleDateString(undefined, …)` estaba mal por partida doble. Primero porque la
 * app NUNCA usa el idioma del dispositivo —lo dice el `LocaleProvider`: el idioma sale
 * de `profiles.locale`, no de `Intl`—, así que un móvil en inglés pintaba
 * "Thursday, 10 September" dentro de una app en castellano.
 *
 * Y segundo porque pasar el locale TAMPOCO lo arregla: `va` no es un locale de Intl, de
 * modo que `toLocaleDateString('va', …)` no devolvería jamás "Dijous". Por eso los
 * nombres salen del CATÁLOGO (`calendario.date.*`), que ya está completo en es/en/va.
 *
 * Las HORAS se quedan en `toLocaleTimeString(undefined, …)` A PROPÓSITO: ahí lo que se
 * busca es el formato numérico del dispositivo (12 h / 24 h), que no depende del idioma.
 */

/** Firma del hook `useTranslations('')` (namespace raíz). */
export type Translate = (key: string, values?: Record<string, string>) => string;

/** Piezas del catálogo. `getDay()`/`getMonth()` en hora local, como el resto de la app. */
function dateParts(t: Translate, d: Date): Record<string, string> {
  return {
    weekday: t(`calendario.date.weekday.${d.getDay()}`),
    day: String(d.getDate()),
    month: t(`calendario.date.month.${d.getMonth()}`),
  };
}

/** "Jueves 10 septiembre" — la fecha en grande del calendario. */
export function formatBigDate(t: Translate, iso: string): string {
  const p = dateParts(t, new Date(iso));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/**
 * "Jueves, 10 de septiembre" — con los conectores de cada idioma, que también viven en
 * el catálogo: el castellano y el valenciano llevan "de" y el inglés no.
 */
export function formatLongDate(t: Translate, iso: string): string {
  return t('calendario.date.long', dateParts(t, new Date(iso)));
}

/** "Jueves, 10 de septiembre · 18:00" — fecha en el idioma de la app + hora del dispositivo. */
export function formatEventWhen(t: Translate, iso: string): string {
  const time = new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatLongDate(t, iso)} · ${time}`;
}
