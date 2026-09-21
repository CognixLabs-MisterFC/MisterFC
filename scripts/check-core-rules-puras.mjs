/**
 * `@misterfc/core/rules` tiene que seguir siendo IMPORTABLE SIN COSTE.
 *
 * Esa entrada existe porque el barrel de core reexporta `supabase/index`, y con él
 * `@supabase/supabase-js` y `@supabase/ssr`. Medido en la app nativa: importar el
 * barrel en un test de lógica pura sube el `collect` de 0,3 s a 10,4 s. Por eso
 * había reglas de core COPIADAS A MANO en `apps/native` — y una regla escrita dos
 * veces acaba diciendo dos cosas distintas.
 *
 * Nada de eso da error por sí solo. Si alguien reexporta desde `rules.ts` un módulo
 * que a su vez importa el cliente, la entrada deja de ser barata EN SILENCIO: los
 * tests siguen pasando, solo que diez veces más lentos, y la próxima persona vuelve
 * a copiar la regla a mano. Esto es lo que lo impide.
 *
 * QUÉ COMPRUEBA: se sigue el grafo de imports desde `packages/core/src/rules.ts`, a
 * través de todo lo que alcanza dentro de core, y se exige que NINGÚN fichero del
 * grafo importe el cliente de Supabase ni nada que lo arrastre.
 *
 * El control positivo del final es la parte que no se puede quitar: si el lector se
 * rompiera y no encontrara imports, este guard pasaría sin comprobar nada.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = join(RAIZ, 'packages/core/src/rules.ts');

/** Lo que NO puede aparecer en el grafo, y por qué. */
const PROHIBIDO = [
  ['@supabase/supabase-js', 'el cliente de Supabase'],
  ['@supabase/ssr', 'el cliente de Supabase (ssr)'],
  ['zod', 'Zod: un esquema no es una regla pura'],
];

/** Resuelve un especificador relativo a un fichero DENTRO de core. */
function resolverLocal(desde, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(desde), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

const RE_IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

function importsDe(fichero) {
  const src = readFileSync(fichero, 'utf8');
  const out = [];
  for (const m of src.matchAll(RE_IMPORT)) out.push(m[1]);
  return out;
}

function recorrer(entrada) {
  const vistos = new Set();
  const pila = [entrada];
  const externos = [];
  let aristas = 0;

  while (pila.length > 0) {
    const f = pila.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    for (const spec of importsDe(f)) {
      aristas += 1;
      const local = resolverLocal(f, spec);
      if (local) pila.push(local);
      else externos.push({ fichero: f, spec });
    }
  }
  return { vistos, externos, aristas };
}

if (!existsSync(ENTRADA)) {
  console.error(`[core-rules] no existe ${relative(RAIZ, ENTRADA)}`);
  process.exit(1);
}

const { vistos, externos, aristas } = recorrer(ENTRADA);
const errores = [];

for (const { fichero, spec } of externos) {
  for (const [malo, motivo] of PROHIBIDO) {
    if (spec === malo || spec.startsWith(`${malo}/`)) {
      errores.push(
        `  ${relative(RAIZ, fichero)}\n      importa '${spec}' → ${motivo}`,
      );
    }
  }
}

// Control positivo: si el lector se rompe, no puede pasar callando.
if (aristas === 0) {
  console.error(
    '[core-rules] el lector no encontró NINGÚN import partiendo de rules.ts.\n' +
      'Eso no es que esté limpio: es que está roto. Revisa RE_IMPORT.',
  );
  process.exit(1);
}

if (errores.length > 0) {
  console.error(
    `[core-rules] @misterfc/core/rules dejó de ser una entrada pura:\n\n${errores.join('\n')}\n\n` +
      'Esa entrada existe para poder importar una regla SIN arrastrar el cliente de\n' +
      'Supabase (medido: 0,3 s → 10,4 s de collect en la app nativa). Si lo arrastra,\n' +
      'la app nativa volverá a copiar las reglas a mano.\n\n' +
      'Saca ese módulo de rules.ts, o parte la regla pura del trozo que habla con la BD.',
  );
  process.exit(1);
}

console.log(
  `[core-rules] OK — ${vistos.size} ficheros alcanzables desde rules.ts, ` +
    `${aristas} imports revisados; ninguno arrastra el cliente.`,
);
