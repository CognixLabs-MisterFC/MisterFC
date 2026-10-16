import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El script del club de capturas (spec §9.3) tiene dos ficheros que el titular pega en
 * el SQL Editor: el ENSAYO, que lo hace todo y lo deshace, y el DEFINITIVO, que lo
 * aplica. Tienen que ser el mismo bloque: si divergen, el ensayo deja de probar lo que
 * se aplica. Y el ensayo no puede llevar un COMMIT escondido, porque aplicaría los
 * cambios.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${process.cwd()}`);
}

const DIR = join(repoRoot(), 'supabase/scripts');
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8');
const ensayo = leer('capturas-club-test.ensayo.sql');
const definitivo = leer('capturas-club-test.sql');

/**
 * Los scripts de capturas que van en pareja ensayo/definitivo. El de la jornada 7
 * deshace un directo empezado por error durante las capturas.
 */
const PAREJAS = [
  { nombre: 'club de capturas', ensayo, definitivo },
  {
    nombre: 'jornada 7 sin directo',
    ensayo: leer('capturas-jornada7-reset.ensayo.sql'),
    definitivo: leer('capturas-jornada7-reset.sql'),
  },
];

/** Lo que va desde `begin;` hasta el final del bloque `do`. */
function bloque(sql: string): string {
  const inicio = sql.indexOf('\nbegin;\n');
  const fin = sql.lastIndexOf('\n$$;\n');
  expect(inicio).toBeGreaterThan(0);
  expect(fin).toBeGreaterThan(inicio);
  return sql.slice(inicio, fin);
}

/** Las sentencias de control de transacción, fuera de comentarios. */
function transacciones(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .map((l) => l.trim().toLowerCase())
    .filter((l) => /^(begin|commit|rollback|end)\s*;$/.test(l));
}

describe.each(PAREJAS)('script $nombre', ({ ensayo, definitivo }) => {
  it('el ensayo es ensayo: v_ensayo = true y termina en rollback, sin commit', () => {
    expect(ensayo).toContain('v_ensayo constant boolean := true;');
    expect(transacciones(ensayo)).toEqual(['begin;', 'end;', 'rollback;']);
  });

  it('el definitivo aplica: v_ensayo = false y termina en commit', () => {
    expect(definitivo).toContain('v_ensayo constant boolean := false;');
    expect(transacciones(definitivo)).toEqual(['begin;', 'end;', 'commit;']);
  });

  it('los dos llevan el mismo bloque, salvo v_ensayo', () => {
    const a = bloque(ensayo).replace('v_ensayo constant boolean := true;', 'X');
    const b = bloque(definitivo).replace('v_ensayo constant boolean := false;', 'X');
    expect(a).toBe(b);
  });

  it('el ensayo aborta siempre al final, también si todo va bien', () => {
    expect(bloque(ensayo)).toMatch(
      /if v_ensayo then\s+raise exception E'ENSAYO CORRECTO, NADA APLICADO/,
    );
  });
});

describe('script del club de capturas', () => {
  it('no toca la cuenta de Apple ni a Carlos Vicente', () => {
    const b = bloque(definitivo);
    // La cuenta de Apple solo se lee para comprobar que existe y que no es una de las renombradas.
    expect(b).not.toMatch(/v_apple\s*,\s*'/);
    expect(b).toContain('p.id <> c_carlos_vicente');
    expect(b).toContain("raise exception 'Carlos Vicente ha cambiado");
  });
});
