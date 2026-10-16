#!/usr/bin/env node
/**
 * GUARD DE CENSO — cada cron tiene su ruta Y su horario.
 *
 * POR QUÉ EXISTE. Un cron de Vercel son DOS cosas en dos sitios: el route handler
 * (`apps/web/src/app/api/cron/<x>/route.ts`) y su entrada en `apps/web/vercel.json`.
 * Si falta la entrada, el handler existe, compila, pasa el typecheck, tiene tests si
 * se los escriben... y NO SE EJECUTA NUNCA. Un job que no arranca no da rojo ni verde:
 * no da nada, y eso es lo peor que puede pasarle a un centinela. Al revés también
 * duele: un horario que apunta a una ruta que ya no existe es un 404 cada vez que
 * dispara, y nadie lo mira.
 *
 * No es una hipótesis. Esta casa ya tuvo un cron que nadie pedía: los recibos de Expo
 * (`/api/cron/push-receipts`) nacieron porque las notificaciones se marcaban `sent`
 * durante semanas sin llegar a ningún teléfono, y el guion que lo habría visto no
 * existía. Este guard es la versión barata de esa lección: que la pieza esté enchufada.
 *
 * QUÉ PONE ROJO:
 *   · una ruta `/api/cron/*` sin entrada en vercel.json → nunca se ejecuta;
 *   · una entrada en vercel.json sin ruta → 404 en cada disparo;
 *   · un horario que no sea un cron de cinco campos → Vercel lo rechaza en el deploy;
 *   · un barrido que no encuentre ni rutas ni entradas → el lector se ha roto.
 *
 * Lo que este guard NO comprueba, para que nadie se confíe: que el cron esté
 * AUTORIZADO (`CRON_SECRET`) ni que de verdad se haya ejecutado. Lo primero es el
 * mismo patrón en las seis rutas; lo segundo solo lo sabe el log de Vercel.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIR_CRONES = join(ROOT, 'apps/web/src/app/api/cron');
const VERCEL_JSON = join(ROOT, 'apps/web/vercel.json');

/** Cron de cinco campos, que es lo que acepta Vercel. */
const CINCO_CAMPOS = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

function rutasEnDisco() {
  let entradas;
  try {
    entradas = readdirSync(DIR_CRONES, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas
    .filter((e) => e.isDirectory())
    .filter((e) => {
      try {
        readFileSync(join(DIR_CRONES, e.name, 'route.ts'), 'utf8');
        return true;
      } catch {
        return false;
      }
    })
    .map((e) => `/api/cron/${e.name}`)
    .sort();
}

const vercel = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'));
const crones = Array.isArray(vercel.crons) ? vercel.crons : [];
const registrados = crones.map((c) => c.path).sort();
const enDisco = rutasEnDisco();

const errores = [];

// Control positivo: un lector roto no puede pasar en verde.
if (enDisco.length < 3) {
  errores.push(
    `barrido roto: solo ${enDisco.length} rutas de cron en disco (esperadas >=3). ` +
      `Revisa ${DIR_CRONES}.`,
  );
}
if (registrados.length < 3) {
  errores.push(
    `barrido roto: solo ${registrados.length} entradas de cron en vercel.json (esperadas >=3).`,
  );
}

const sinHorario = enDisco.filter((r) => !registrados.includes(r));
if (sinHorario.length > 0) {
  errores.push(
    `${sinHorario.length} cron(es) que NO SE EJECUTAN NUNCA: tienen route handler y no ` +
      `tienen horario en apps/web/vercel.json:\n` +
      sinHorario.map((r) => `    ${r}`).join('\n'),
  );
}

const sinRuta = registrados.filter((r) => !enDisco.includes(r));
if (sinRuta.length > 0) {
  errores.push(
    `${sinRuta.length} horario(s) que apuntan a una ruta que no existe (404 en cada ` +
      `disparo):\n` +
      sinRuta.map((r) => `    ${r}`).join('\n'),
  );
}

for (const c of crones) {
  if (typeof c.schedule !== 'string' || !CINCO_CAMPOS.test(c.schedule.trim())) {
    errores.push(
      `horario no válido para ${c.path}: ${JSON.stringify(c.schedule)}. Vercel espera ` +
        `un cron de cinco campos.`,
    );
  }
}

if (errores.length > 0) {
  console.error('✗ check:crones-registrados\n');
  for (const e of errores) console.error(`  · ${e}\n`);
  process.exit(1);
}

console.log(
  `✓ check:crones-registrados — ${enDisco.length} crones, todos con ruta y horario: ` +
    crones
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((c) => `${c.path} (${c.schedule})`)
      .join(', ') +
    '.',
);
