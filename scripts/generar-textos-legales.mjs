#!/usr/bin/env node
/**
 * Legal-1 — Genera la copia servida de los textos legales desde la copia MAESTRA.
 *
 * Corre ANTES de `next build` y de `next dev` (apps/web/package.json, encadenado con
 * `&&`, no como `prebuild`: los pre-scripts dependen de la configuración del gestor
 * de paquetes y esto no puede depender de eso). Los .md generados no se versionan.
 *
 * Es idempotente y no tiene modo "parcial": o escribe los tres, o falla. Un build con
 * dos de tres textos legales publicaría una página rota sin decir nada.
 */

import { generar, SERVIDA_REL } from './textos-legales.mjs';

try {
  const escritos = generar();
  const detalle = escritos.map((e) => `${e.slug}.md (${e.bytes} B)`).join(', ');
  console.log(`✓ textos legales generados en ${SERVIDA_REL}/: ${detalle}`);
} catch (err) {
  console.error(`✗ no se pudieron generar los textos legales\n\n  · ${err.message}\n`);
  process.exit(1);
}
