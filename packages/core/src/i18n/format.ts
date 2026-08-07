/**
 * Motor i18n COMPARTIDO (subconjunto ICU) para consumir el MISMO catálogo que la
 * web: `messages/{es,en,va}.json` en la raíz del monorepo (fuente de verdad única).
 *
 * apps/web usa `next-intl` (runtime de Next, no portable a React Native). Este
 * módulo es puro y framework-agnóstico: resuelve claves ANIDADas por namespaces
 * (`perfil.avatar.hint`) e interpola con el subconjunto de ICU que la web usa hoy
 * — interpolación `{var}`, `plural` (`=N` / `one` / `other`, con `#`) y `select`.
 * apps/native lo envuelve en un Provider reactivo; aquí solo va la lógica pura
 * (testeable en core). NO importa ningún JSON: el caller inyecta el catálogo.
 */

/** Un catálogo de mensajes: objeto anidado (namespaces) cuyas hojas son strings. */
export type Messages = { [key: string]: string | Messages };

export type TranslateValue = string | number;
export type TranslateValues = Record<string, TranslateValue>;

/** Resuelve una clave con puntos (`a.b.c`) dentro del catálogo anidado. null si no existe o no es hoja. */
export function lookupMessage(messages: Messages, path: string): string | null {
  const parts = path.split('.');
  let cur: string | Messages = messages;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return null;
    cur = (cur as Messages)[part]!;
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * Categoría plural CLDR para es/en/va. Las tres comparten la misma regla cardinal:
 * `one` si n === 1, `other` en el resto (español, inglés y valencià/català coinciden).
 * Se mantiene el parámetro `locale` por firma/extensibilidad; hoy no ramifica.
 */
export function pluralCategory(n: number, _locale: string): 'one' | 'other' {
  return n === 1 ? 'one' : 'other';
}

// ── Parser del subconjunto ICU ──────────────────────────────────────────────

/** Desde `start` (índice de un `{`) devuelve el contenido interno y el índice tras el `}` que casa. */
function readBraces(input: string, start: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    const c = input[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { inner: input.slice(start + 1, i), end: i + 1 };
    }
  }
  // Sin cierre: devolvemos el resto (mensaje malformado → mejor no romper).
  return { inner: input.slice(start + 1), end: input.length };
}

/** Parsea `=1 {..} one {..} other {..}` → mapa selector→plantilla. */
function parseOptions(rest: string): Record<string, string> {
  const options: Record<string, string> = {};
  let i = 0;
  while (i < rest.length) {
    // Salta espacios.
    if (rest[i] === ' ' || rest[i] === '\n' || rest[i] === '\t') {
      i++;
      continue;
    }
    // Lee el selector (hasta espacio o '{').
    let selector = '';
    while (i < rest.length && rest[i] !== ' ' && rest[i] !== '{') {
      selector += rest[i];
      i++;
    }
    // Salta espacios hasta el '{'.
    while (i < rest.length && rest[i] !== '{') i++;
    if (i >= rest.length) break;
    const { inner, end } = readBraces(rest, i);
    if (selector) options[selector] = inner;
    i = end;
  }
  return options;
}

/** Formatea el contenido de un `{...}`: `name`, `name, plural, ...` o `name, select, ...`. */
function formatArg(
  inner: string,
  values: TranslateValues,
  locale: string,
): string {
  const firstComma = inner.indexOf(',');
  if (firstComma === -1) {
    // `{name}` → interpolación simple.
    const name = inner.trim();
    const v = values[name];
    return v === undefined || v === null ? '' : String(v);
  }

  const name = inner.slice(0, firstComma).trim();
  const afterName = inner.slice(firstComma + 1);
  const secondComma = afterName.indexOf(',');
  const type = (secondComma === -1 ? afterName : afterName.slice(0, secondComma)).trim();
  const optionsRaw = secondComma === -1 ? '' : afterName.slice(secondComma + 1);
  const options = parseOptions(optionsRaw);

  if (type === 'plural' || type === 'selectordinal') {
    const num = Number(values[name] ?? 0);
    const exact = options[`=${num}`];
    const branch = exact ?? options[pluralCategory(num, locale)] ?? options.other ?? '';
    return formatICU(branch, values, locale, String(num));
  }

  if (type === 'select') {
    const key = String(values[name] ?? '');
    const branch = options[key] ?? options.other ?? '';
    return formatICU(branch, values, locale, null);
  }

  // Tipo no soportado (number/date/time): interpolación cruda del valor.
  const v = values[name];
  return v === undefined || v === null ? '' : String(v);
}

/**
 * Formatea una plantilla ICU (subconjunto). `pound` es el valor que sustituye a `#`
 * dentro de una rama plural seleccionada (null fuera de plural). Respeta el quoting
 * ICU con apóstrofo: `''`→`'`; `'{`/`'}`/`'#` inician literal citado; un apóstrofo
 * suelto (p.ej. valencià «l'app») es literal.
 */
export function formatICU(
  template: string,
  values: TranslateValues,
  locale: string,
  pound: string | null = null,
): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i];

    if (c === "'") {
      const next = template[i + 1];
      if (next === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (next === '{' || next === '}' || next === '#' || next === '|') {
        // Sección citada: copia verbatim hasta el siguiente apóstrofo (o fin).
        let j = i + 1;
        let lit = '';
        while (j < template.length && template[j] !== "'") {
          lit += template[j];
          j++;
        }
        out += lit;
        i = j < template.length ? j + 1 : j;
        continue;
      }
      // Apóstrofo suelto → literal.
      out += "'";
      i++;
      continue;
    }

    if (c === '#' && pound !== null) {
      out += pound;
      i++;
      continue;
    }

    if (c === '{') {
      const { inner, end } = readBraces(template, i);
      out += formatArg(inner, values, locale);
      i = end;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Traduce una clave del catálogo. `namespace` opcional (estilo `useTranslations('perfil')`
 * de next-intl → `t('avatar.hint')`). Si la clave no existe, devuelve la clave completa
 * (fallback visible, no lanza).
 */
export function translate(
  messages: Messages,
  namespace: string | undefined,
  key: string,
  values: TranslateValues,
  locale: string,
): string {
  const fullKey = namespace ? `${namespace}.${key}` : key;
  const template = lookupMessage(messages, fullKey);
  if (template === null) return fullKey;
  return formatICU(template, values, locale);
}
