/**
 * F14-11/12 — Carga de los TEXTOS LEGALES REALES de un club desde ficheros .md.
 *
 * Los documentos legales son INDEPENDIENTES POR CLUB (F14-11/12). Este script
 * publica una NUEVA versión (version = max+1) de cada doc_type de un club a
 * partir de 5 ficheros .md. Los .md son la fuente (los aporta el asesor legal,
 * fuera del repo). NO borra ni edita versiones previas (legal_documents es
 * histórico: cada publicación es una versión nueva; "vigente" = la mayor).
 *
 * La escritura usa service_role (bypassa la RLS por club). La pantalla de
 * publicación con UI va en la fase multiclub/superadmin (F14-13+).
 *
 * Uso:
 *   cd apps/web && node scripts/load-legal-docs.mjs --club <club_id|slug> --dir <ruta>
 *   node scripts/load-legal-docs.mjs --club club-beta-test --dir ~/legal/beta --dry-run
 *   node scripts/load-legal-docs.mjs --club club-beta-test --dir ~/legal/beta --requires-resignature
 *
 * En <ruta> se esperan 5 ficheros (los que falten se OMITEN con aviso):
 *   privacy_policy.md  terms_conditions.md  image_internal.md
 *   image_social.md    medical_informed_consent.md
 * El título del documento = primer encabezado markdown (# ...) del fichero; si
 * no hay, se usa un título por defecto. El body = contenido íntegro del .md.
 *
 * IDEMPOTENCIA (F14-14): antes de publicar se compara el body del .md con el de la
 * versión VIGENTE (max) de ese club/doc_type. Si COINCIDEN no se publica versión
 * nueva (se avisa y se sigue con los demás). "Coinciden" = iguales tras normalizar
 * ÚNICAMENTE el espacio en blanco FINAL del fichero (saltos de línea y espacios al
 * final). NO se normaliza el contenido: un cambio de espaciado DENTRO del texto
 * legal es un cambio real y publica versión nueva.
 *
 * RE-FIRMA (F14-14): --requires-resignature marca la versión publicada como cambio
 * SUSTANCIAL → los tutores caen en la pantalla de re-consentimiento (solo ese
 * doc_type). Por defecto FALSE (cambio menor: nadie re-firma hasta el rollover).
 *
 * Requisitos en apps/web/.env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_TYPES = [
  { type: 'privacy_policy', file: 'privacy_policy.md', defaultTitle: 'Política de Privacidad' },
  { type: 'terms_conditions', file: 'terms_conditions.md', defaultTitle: 'Términos y Condiciones' },
  { type: 'image_internal', file: 'image_internal.md', defaultTitle: 'Consentimiento de imagen — uso interno' },
  { type: 'image_social', file: 'image_social.md', defaultTitle: 'Consentimiento de imagen — redes sociales' },
  { type: 'medical_informed_consent', file: 'medical_informed_consent.md', defaultTitle: 'Consentimiento informado de datos médicos' },
];

// ── Args ─────────────────────────────────────────────────────────────────────
function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const CLUB = argVal('--club');
const DIR = argVal('--dir');
const DRY_RUN = process.argv.includes('--dry-run');
const REQUIRES_RESIGNATURE = process.argv.includes('--requires-resignature');
if (!CLUB || !DIR) {
  console.error('Uso: node scripts/load-legal-docs.mjs --club <club_id|slug> --dir <ruta> [--dry-run]');
  process.exit(1);
}

// ── Env ──────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleFromMarkdown(body, fallback) {
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*#\s+(.+?)\s*$/);
    if (m) return m[1].slice(0, 200);
  }
  return fallback;
}

// Idempotencia (F14-14): normaliza SOLO el espacio en blanco FINAL del fichero
// (saltos de línea y espacios al final). NO toca el contenido interior: un cambio
// de espaciado dentro del texto ES un cambio y debe publicar versión nueva.
function normalizeTrailing(text) {
  return text.replace(/\s+$/u, '');
}

// Versión vigente (id, version, body) de un club/doc_type, o null si no existe.
async function currentDoc(clubId, docType) {
  const { data, error } = await supabase
    .from('legal_documents')
    .select('id, version, body')
    .eq('club_id', clubId)
    .eq('doc_type', docType)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function resolveClubId(clubRef) {
  if (UUID_RE.test(clubRef)) return clubRef;
  const { data, error } = await supabase.from('clubs').select('id, name').eq('slug', clubRef).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No existe un club con slug "${clubRef}"`);
  console.log(`  club: ${data.name} (${data.id})`);
  return data.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nF14-14 · carga de textos legales${DRY_RUN ? ' (DRY-RUN)' : ''}`);
  if (REQUIRES_RESIGNATURE) console.log('  ⚑ requires_resignature=TRUE (cambio sustancial: exige re-firma)');
  const clubId = await resolveClubId(CLUB);

  let published = 0;
  let unchanged = 0;
  for (const dt of DOC_TYPES) {
    const path = join(DIR, dt.file);
    if (!existsSync(path)) {
      console.log(`  – ${dt.type}: sin fichero (${dt.file}), OMITIDO`);
      continue;
    }
    const body = readFileSync(path, 'utf8');
    if (!body.trim()) {
      console.log(`  – ${dt.type}: fichero vacío, OMITIDO`);
      continue;
    }
    const title = titleFromMarkdown(body, dt.defaultTitle);
    const current = await currentDoc(clubId, dt.type);

    // Idempotencia: si el body coincide con el vigente (salvo espacio final), no
    // se publica versión nueva.
    if (current && normalizeTrailing(current.body) === normalizeTrailing(body)) {
      console.log(`  = ${dt.type}: sin cambios respecto a v${current.version}, no ${DRY_RUN ? 'publicaría' : 'se publica'}`);
      unchanged++;
      continue;
    }

    const version = (current?.version ?? 0) + 1;
    const resign = REQUIRES_RESIGNATURE ? ' · exige re-firma' : '';

    if (DRY_RUN) {
      console.log(`  · ${dt.type}: publicaría v${version} — "${title}" (${body.length} chars${resign})`);
      continue;
    }
    const { error } = await supabase
      .from('legal_documents')
      .insert({
        club_id: clubId,
        doc_type: dt.type,
        version,
        title,
        body,
        requires_resignature: REQUIRES_RESIGNATURE,
      });
    if (error) throw error;
    console.log(`  ✓ ${dt.type}: publicado v${version} — "${title}"${resign}`);
    published++;
  }

  console.log(
    `\n${DRY_RUN ? 'Dry-run completado.' : `Publicados ${published} documento(s)`}` +
      `${unchanged ? ` · ${unchanged} sin cambios` : ''}.\n`,
  );
}

main().catch((e) => {
  console.error('✗ Error:', e.message ?? e);
  process.exit(1);
});
