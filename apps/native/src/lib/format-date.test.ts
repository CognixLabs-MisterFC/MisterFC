import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatBigDate,
  formatDayMonthYear,
  formatEventWhen,
  formatLongDate,
  formatShortDate,
  formatShortDateTime,
  type Translate,
} from './format-date';

/**
 * Las fechas de la app salen del CATÁLOGO, no del dispositivo.
 *
 * #589 arregló los tres sitios que pintaban NOMBRES (un móvil en inglés enseñaba
 * "Thursday, 10 September" dentro de una app en castellano) y dejó anotado el resto:
 * 27 llamadas más con fecha NUMÉRICA, que no pintan inglés pero sí siguen al
 * dispositivo en el ORDEN — `9/10/2026` en un móvil en `en-US`.
 *
 * Aquí se comprueban dos cosas distintas:
 *
 *   · que los helpers RENDERIZAN lo que decimos, contra el catálogo de verdad;
 *   · y el CENSO: que no queda ni una llamada a `toLocaleDateString`/`toLocaleString`
 *     en toda la app. Esa es la parte que envejece sola — el helper no se rompe, se
 *     esquiva, y el síntoma es una fecha con el orden cambiado que solo ve quien tiene
 *     el móvil en otro idioma.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const SRC = join(__dirname, '..');
const LOCALES = ['es', 'en', 'va'] as const;

/**
 * Un `t` de juguete sobre el catálogo real. NO usa el motor de core a propósito: ningún
 * test de apps/native importa `@misterfc/core`, y estas cadenas solo llevan
 * interpolación simple `{x}`. Si algún día llevaran plurales, este atajo se rompería de
 * forma ruidosa (quedaría la llave en el resultado) y no en silencio.
 */
function tDe(loc: string): Translate {
  const cat = JSON.parse(readFileSync(join(RAIZ, 'messages', `${loc}.json`), 'utf8'));
  return (key, values) => {
    const plantilla = key.split('.').reduce((o: unknown, k) =>
      o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined, cat);
    if (typeof plantilla !== 'string') return key;
    return plantilla.replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? `{${n}}`));
  };
}

const ISO = '2026-09-10T18:30:00';

describe('los helpers, contra el catálogo real', () => {
  it('fecha numérica: dos dígitos y el mismo orden en los tres idiomas', () => {
    for (const loc of LOCALES) {
      expect(formatShortDate(tDe(loc), ISO)).toBe('10/09/2026');
    }
  });

  it('fecha numérica + hora', () => {
    // La HORA sale del dispositivo a propósito (12 h / 24 h), así que se comprueba la
    // parte que sí decidimos nosotros y que la hora va detrás, no delante.
    const out = formatShortDateTime(tDe('es'), ISO);
    expect(out.startsWith('10/09/2026, ')).toBe(true);
    expect(out.length).toBeGreaterThan('10/09/2026, '.length);
  });

  it('día + mes con NOMBRE + año, en cada idioma', () => {
    expect(formatDayMonthYear(tDe('es'), ISO)).toBe('10 septiembre 2026');
    expect(formatDayMonthYear(tDe('en'), ISO)).toBe('10 September 2026');
    expect(formatDayMonthYear(tDe('va'), ISO)).toBe('10 setembre 2026');
  });

  // Los de #589 siguen donde estaban: esto es una regresión, no una novedad.
  it('los nombres de #589 no se han movido', () => {
    expect(formatBigDate(tDe('es'), ISO)).toBe('Jueves 10 septiembre');
    expect(formatLongDate(tDe('es'), ISO)).toBe('Jueves, 10 de septiembre');
    expect(formatLongDate(tDe('en'), ISO)).toBe('Thursday, 10 September');
    expect(formatEventWhen(tDe('es'), ISO).startsWith('Jueves, 10 de septiembre · ')).toBe(true);
  });

  // Un mes de un dígito y un día de un dígito: el sitio donde se ve si falta el padding.
  it('el 1 de enero lleva ceros', () => {
    expect(formatShortDate(tDe('es'), '2026-01-01T09:00:00')).toBe('01/01/2026');
  });
});

// ── El censo ────────────────────────────────────────────────────────────────

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return fuentes(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Líneas de código (sin comentarios) que llaman a un `toLocale*`. */
function llamadas(re: RegExp): string[] {
  return fuentes(SRC).flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .map((l, i) => ({ l: l.trim(), i }))
      .filter(({ l }) => !l.startsWith('*') && !l.startsWith('//') && re.test(l))
      .map(({ i }) => `${f.replace(SRC, '')}:${i + 1}`),
  );
}

describe('censo: la fecha no sale del dispositivo', () => {
  it('el censo mira algo (si no encuentra ni un fuente, no prueba nada)', () => {
    expect(fuentes(SRC).length).toBeGreaterThan(100);
  });

  it('nadie llama a toLocaleDateString ni a toLocaleString', () => {
    expect(llamadas(/\.toLocale(Date)?String\s*\(/)).toEqual([]);
  });

  /**
   * La HORA sí sale del dispositivo, y es deliberado: ahí lo que se busca es 12 h / 24 h.
   * Pero la lista es cerrada — no para prohibirla, sino para que añadir una obligue a
   * mirar si lo que se está pintando es una hora o una fecha disfrazada.
   */
  it('las horas del dispositivo son las conocidas, y solo esas', () => {
    // Por FICHERO y no por línea: una lista de líneas se rompe con cualquier edición de
    // más arriba, y un censo que se pone rojo por nada acaba borrado.
    const ficheros = [...new Set(llamadas(/\.toLocaleTimeString\s*\(/).map((x) => x.split(':')[0]))];
    expect(ficheros.sort()).toEqual(
      [
        '/lib/format-date.ts',
        '/screens/direction/pending-events-list.tsx',
        '/screens/family/calendario-temporada.tsx',
        '/screens/family/calendario.tsx',
        '/screens/staff/sesion-del-dia.tsx',
      ].sort(),
    );
  });
});
