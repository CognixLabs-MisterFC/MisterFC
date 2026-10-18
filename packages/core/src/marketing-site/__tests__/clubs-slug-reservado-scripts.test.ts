import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * La migración 20261129000000 (trigger de slugs reservados en `clubs`) se aplica a mano
 * en el SQL Editor con dos ficheros de `supabase/scripts/`: el ensayo (ROLLBACK) y el
 * definitivo (COMMIT). Lo que se ensaya tiene que ser exactamente lo que se aplica, y lo
 * que se aplica, exactamente la migración del repo.
 *
 *   · el bloque entre las marcas de cada script es COPIA LITERAL de la migración;
 *   · ensayo y definitivo solo se diferencian en la cabecera, `v_ensayo` y el verbo final;
 *   · el ensayo acaba en ROLLBACK y el definitivo en COMMIT, y empiezan por BEGIN.
 */
const leer = (ruta: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../../${ruta}`, import.meta.url)), 'utf8');

const migracion = leer('supabase/migrations/20261129000000_clubs_slug_reservado_trigger.sql');
const ensayo = leer('supabase/scripts/clubs-slug-reservado.ensayo.sql');
const definitivo = leer('supabase/scripts/clubs-slug-reservado.sql');

const INICIO =
  '-- ═══ MIGRACIÓN (copia literal de supabase/migrations/20261129000000_clubs_slug_reservado_trigger.sql) ═══\n';
const FIN = '\n-- ═══ FIN DE LA MIGRACIÓN ═══';

function bloque(script: string): string {
  const i = script.indexOf(INICIO);
  const f = script.indexOf(FIN);
  if (i < 0 || f < 0) throw new Error('faltan las marcas de la migración');
  return script.slice(i + INICIO.length, f);
}

/** Las líneas útiles (sin comentarios ni vacías), para mirar la primera y la última. */
const utiles = (s: string) =>
  s.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));

describe('scripts del trigger de slugs reservados', () => {
  it('premisa: la migración crea el trigger', () => {
    expect(migracion).toContain('create trigger clubs_slug_no_reservado');
  });

  it.each([
    ['ensayo', ensayo],
    ['definitivo', definitivo],
  ])('el %s lleva la migración copiada letra por letra', (_, script) => {
    expect(bloque(script)).toBe(migracion.replace(/\n+$/, ''));
  });

  it('el ensayo empieza por BEGIN y acaba en ROLLBACK, con v_ensayo = true', () => {
    expect(utiles(ensayo)[0]).toBe('begin;');
    expect(utiles(ensayo).at(-1)).toBe('rollback;');
    expect(ensayo).toContain('v_ensayo constant boolean := true;');
  });

  it('el definitivo empieza por BEGIN y acaba en COMMIT, con v_ensayo = false', () => {
    expect(utiles(definitivo)[0]).toBe('begin;');
    expect(utiles(definitivo).at(-1)).toBe('commit;');
    expect(definitivo).toContain('v_ensayo constant boolean := false;');
  });

  it('fuera de la cabecera, solo cambian v_ensayo y el verbo final', () => {
    const cuerpo = (s: string) =>
      s
        .slice(s.indexOf('\nbegin;\n'))
        .replace(/v_ensayo constant boolean := (true|false);/, 'v_ensayo constant boolean := X;')
        .replace(/\n(rollback|commit);\n?$/, '\nFIN;');
    expect(cuerpo(ensayo)).toBe(cuerpo(definitivo));
  });

  it('ni el ensayo ni el definitivo llevan un COMMIT o ROLLBACK a mitad', () => {
    for (const s of [ensayo, definitivo]) {
      const verbos = utiles(s).filter((l) => /^(commit|rollback);$/i.test(l.trim()));
      expect(verbos).toHaveLength(1);
    }
  });
});
