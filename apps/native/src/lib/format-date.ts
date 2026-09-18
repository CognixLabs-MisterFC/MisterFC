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

// ─────────────────────────────────────────────────────────────────────────────
// Fechas NUMÉRICAS. El otro lado del mismo defecto.
//
// #589 arregló los tres sitios que pintaban NOMBRES con el idioma del dispositivo y
// dejó anotado lo que no cabía: 27 llamadas más, en 25 ficheros, con fecha numérica
// (`toLocaleString()` / `toLocaleDateString()` sin locale). Esas no pintan inglés,
// pero siguen al dispositivo en el ORDEN: un móvil en `en-US` enseña `9/10/2026`
// donde la app dice `10/09/2026`. Mismo defecto de fondo, de otro tamaño.
//
// Por qué el catálogo y no `padStart` a pelo, que es lo que hacían tres helpers
// duplicados por ahí: porque el ORDEN de una fecha numérica es una convención de
// IDIOMA, y el sitio donde se decide tiene que ser el mismo donde se deciden los
// nombres de los meses. Hoy los tres idiomas llevan `{day}/{month}/{year}` —el inglés
// también, porque el club está en España y `10/09` tiene que querer decir lo mismo en
// las tres versiones de la misma pantalla—, y el día que eso cambie se cambia una
// cadena, no veinticinco ficheros.
//
// La HORA sigue saliendo de `toLocaleTimeString(undefined, …)`, igual que arriba y por
// el mismo motivo: ahí lo que se busca es 12 h / 24 h del dispositivo.
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** La hora del dispositivo, HH:MM. El único trozo que NO sale del catálogo. */
function deviceTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "10/09/2026". */
export function formatShortDate(t: Translate, iso: string): string {
  const d = new Date(iso);
  return t('calendario.date.numeric', {
    day: pad2(d.getDate()),
    month: pad2(d.getMonth() + 1),
    year: String(d.getFullYear()),
  });
}

/**
 * "10/09/2026, 18:00".
 *
 * Sustituye a `toLocaleString()` a secas, que además de seguir al dispositivo pintaba
 * los SEGUNDOS ("10/9/2026, 18:00:00"). Las llamadas que sí pasaban opciones ya pedían
 * día + hora sin segundos: esto las iguala a todas.
 */
export function formatShortDateTime(t: Translate, iso: string): string {
  return t('calendario.date.numeric_time', {
    date: formatShortDate(t, iso),
    time: deviceTime(new Date(iso)),
  });
}

/** "10 septiembre 2026" — día + mes CON NOMBRE + año, sin el día de la semana. */
export function formatDayMonthYear(t: Translate, iso: string): string {
  const d = new Date(iso);
  return t('calendario.date.day_month_year', {
    day: String(d.getDate()),
    month: t(`calendario.date.month.${d.getMonth()}`),
    year: String(d.getFullYear()),
  });
}
