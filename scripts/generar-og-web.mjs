#!/usr/bin/env node
/**
 * Web comercial (spec §11) — genera las imágenes OpenGraph, una por idioma:
 * `apps/web/public/web/og/{es,va,en}.png` (1200×630), con el logo, «MisterFC» y el
 * titular del hero de `messages-web/{idioma}.json`, en Inter.
 *
 * Se ejecuta a mano cuando cambia el titular o el logo, y las PNG se versionan: así la
 * imagen no depende de una descarga en cada build. Usa `ImageResponse` de `next/og`,
 * lo mismo que usaría una ruta de Next. Inter se descarga de Google Fonts al ejecutarlo.
 *
 *   node scripts/generar-og-web.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');
const require = createRequire(join(WEB, 'package.json'));
const { ImageResponse } = require('next/og');
const React = require('react');
const h = React.createElement;

/** Inter estática (TTF) desde Google Fonts: satori no lee woff2. */
async function inter(weight) {
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`, {
      headers: { 'User-Agent': 'Mozilla/4.0' }, // un navegador viejo recibe TTF
    })
  ).text();
  const url = /src: url\((https:[^)]+)\) format\('truetype'\)/.exec(css)?.[1];
  if (!url) throw new Error(`Google Fonts no devolvió Inter ${weight} en TTF`);
  return (await fetch(url)).arrayBuffer();
}

const NAVY = '#0F1B2E';
const GREEN = '#10B981';
const icono = `data:image/png;base64,${readFileSync(join(WEB, 'public/web/misterfc-icono.png')).toString('base64')}`;
const [regular, bold] = await Promise.all([inter(500), inter(700)]);

mkdirSync(join(WEB, 'public/web/og'), { recursive: true });
for (const locale of ['es', 'va', 'en']) {
  const m = JSON.parse(readFileSync(join(WEB, `messages-web/${locale}.json`), 'utf8'));
  const { antetitulo, titular } = m.portada.hero;
  const img = new ImageResponse(
    h(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: NAVY,
          color: 'white',
          padding: '72px 80px',
          fontFamily: 'Inter',
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 24 } },
        h('img', { src: icono, width: 88, height: 88, style: { borderRadius: 20 } }),
        h('div', { style: { fontSize: 52, fontWeight: 700 } }, 'MisterFC'),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
        h('div', { style: { fontSize: 30, fontWeight: 500, color: GREEN } }, antetitulo),
        h(
          'div',
          { style: { fontSize: 60, fontWeight: 700, lineHeight: 1.12, maxWidth: 1000 } },
          titular,
        ),
      ),
      h('div', { style: { height: 10, width: 160, background: GREEN, borderRadius: 5 } }),
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Inter', data: regular, weight: 500, style: 'normal' },
        { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
  const png = Buffer.from(await img.arrayBuffer());
  writeFileSync(join(WEB, `public/web/og/${locale}.png`), png);
  console.log(`✓ public/web/og/${locale}.png (${png.length} B)`);
}
