import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-2 — CENSO de la escritura de la declaración de mayoría de edad.
 *
 * QUÉ SE PROTEGE. La casilla «Declaro que soy mayor de 18 años» se pide antes de la RPC
 * (#722) y se GUARDA después, en `player_accounts.adult_declared_at` (mig 20261109000000).
 * Una casilla que no se guarda en ninguna parte no es una declaración: es un trámite.
 *
 * POR QUÉ UN CENSO QUE LEE EL FICHERO. `apps/web` no tiene runner de tests y esto es un
 * Server Action que habla con Supabase; lo que se puede probar de verdad —a qué vínculos
 * le toca— vive en core y tiene su test (`self.test.ts`, bloque D-2). Aquí se vigila el
 * CABLEADO, que es lo que se rompe en silencio:
 *
 *  · si la escritura desaparece o se mueve ANTES de la RPC, el vínculo aún no existe y
 *    son cero filas — y un `.update()` de PostgREST que no encaja con nada NO da error;
 *  · si se cae el filtro `is('adult_declared_at', null)`, el segundo submit de un alta
 *    choca con el trigger de inmutabilidad (23514), y solo pasa en producción;
 *  · si alguien mete `invited_user_id` como apoyo del uid, la declaración puede acabar
 *    pegada al vínculo del OTRO tutor del mismo hijo: una prueba inventada.
 *
 * Ninguna de las tres se nota probando el alta a mano: las tres dejan la pantalla verde.
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

const RUTA = 'apps/web/src/app/[locale]/invite/[token]/actions.ts';
const FUENTE = readFileSync(join(repoRoot(), RUTA), 'utf8');

/** El cuerpo del escritor, de su firma a la siguiente función de primer nivel. */
function cuerpoDelEscritor(): string {
  const desde = FUENTE.indexOf('async function recordAdultDeclaration(');
  if (desde < 0) return '';
  const resto = FUENTE.slice(desde + 1);
  const hasta = resto.search(/\n(?:async )?function \w+/);
  return hasta < 0 ? resto : resto.slice(0, hasta);
}

const ESCRITOR = cuerpoDelEscritor();

/**
 * El mismo cuerpo SIN COMENTARIOS. Hace falta para las aserciones en negativo: aquí se
 * explica por escrito por qué NO se usa `invited_user_id`, y un `not.toContain` sobre el
 * texto crudo prohibiría precisamente explicarlo. Lo que no debe aparecer es la LLAMADA.
 */
const CODIGO = ESCRITOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * LA CADENA DEL UPDATE, sola. Y no es un refinamiento: exigir los filtros «en algún
 * sitio de la función» daba verde a las dos averías que este fichero dice cazar. El
 * `is('adult_declared_at', null)` estaba también escrito en un comentario, y
 * `.select('player_id')` lo pone además la consulta de comprobación. Medido: con esos dos
 * cortados del UPDATE, el fichero pasaba entero.
 */
function cadenaDelUpdate(): string {
  const desde = CODIGO.indexOf('.update({ adult_declared_at');
  if (desde < 0) return '';
  const hasta = CODIGO.indexOf(';', desde);
  return hasta < 0 ? '' : CODIGO.slice(desde, hasta);
}

const UPDATE = cadenaDelUpdate();

describe('la declaración de mayoría de edad se guarda', () => {
  // CONTROL POSITIVO. Sin él, un renombrado de la función dejaría `ESCRITOR` vacío y
  // todas las aserciones de abajo pasarían midiendo una cadena vacía.
  it('hay un escritor, y tiene cuerpo', () => {
    expect(ESCRITOR.length).toBeGreaterThan(400);
    expect(ESCRITOR).toContain('adult_declared_at');
    // Y quitar los comentarios deja CÓDIGO, no un cascarón: si esta resta se comiera el
    // cuerpo entero, la aserción en negativo de más abajo pasaría sin mirar nada.
    expect(CODIGO).toContain('adult_declared_at');
    expect(CODIGO.length).toBeGreaterThan(300);
    // Y la cadena del UPDATE se ha encontrado: sin ella, cuatro aserciones de abajo
    // medirían una cadena vacía y pasarían solas.
    expect(UPDATE.length).toBeGreaterThan(80);
  });

  it('escribe la fecha y hora en el vínculo, no en otra tabla', () => {
    expect(CODIGO).toContain("from('player_accounts')");
    expect(UPDATE).toContain('.update({ adult_declared_at: cuando })');
    expect(CODIGO).toContain('new Date().toISOString()');
  });

  it('se llama DESPUÉS de que la RPC haya comprometido', () => {
    const rpc = FUENTE.indexOf("if ('error' in attached)");
    const llamada = FUENTE.indexOf('await recordAdultDeclaration(');
    expect(rpc).toBeGreaterThan(0);
    expect(llamada).toBeGreaterThan(rpc);
  });

  it('solo toca los vínculos de ESTE aceptante, y solo los de tutor', () => {
    expect(UPDATE).toContain(".eq('profile_id', uid)");
    expect(UPDATE).toContain(".in('player_id', playerIds)");
    expect(UPDATE).toContain(".in('relation', ['parent', 'guardian'])");
    // La lista de hijos sale de core, que es donde está probada.
    expect(CODIGO).toContain('tutorLinkPlayerIds(pending)');
  });

  it('el uid sale de la sesión y de ningún otro sitio', () => {
    expect(CODIGO).toContain('supabase.auth.getUser()');
    expect(CODIGO).not.toContain('invited_user_id');
  });

  it('el doble submit no choca con el trigger de inmutabilidad', () => {
    expect(UPDATE).toContain(".is('adult_declared_at', null)");
  });

  it('la escritura NO es muda: se comprueba cuántas filas ha sellado', () => {
    // `.select()` es lo que hace que PostgREST devuelva las filas tocadas; sin él no hay
    // forma de saber si fueron cero.
    expect(UPDATE).toContain(".select('player_id')");
    expect(CODIGO).toContain('playerIds.length');
    expect(CODIGO).toMatch(/Sentry\.captureMessage/);
  });
});
