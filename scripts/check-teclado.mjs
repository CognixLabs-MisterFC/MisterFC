#!/usr/bin/env node
/**
 * GUARD DE CENSO — el teclado no tapa el campo (app nativa).
 *
 * POR QUÉ EXISTE. El fallo que arregla esta tanda no fue que faltara una librería:
 * fue que el manejo del teclado **se olvidaba pantalla a pantalla**. De 17 ficheros
 * con campos de texto, 15 no hacían nada, y los 2 que sí lo hacían montaban el
 * `KeyboardAvoidingView` de React Native con
 * `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — o sea, nada en
 * Android, que es donde se prueba. Un censo a mano vuelve a quedarse viejo con la
 * pantalla siguiente; este script es lo que impide que pase.
 *
 * QUÉ COMPRUEBA, y solo esto:
 *   1. el `KeyboardProvider` sigue en el layout raíz — sin él los tres componentes
 *      se montan sin error y no hacen NADA, que es el peor de los fallos posibles;
 *   2. todo fichero de `apps/native` con un `<TextInput` está censado abajo;
 *   3. los que declaran usar un componente de `@/ui/keyboard` lo importan de verdad;
 *   4. los exentos siguen sin traer manejo propio (si lo traen, el motivo miente);
 *   5. nadie ha vuelto a meter el `KeyboardAvoidingView` de `react-native`.
 *
 * La 5 es la que cierra el círculo: la pieza que falló está a un import de distancia
 * y se parece mucho a la buena. Si alguien la vuelve a traer, esto se pone rojo y
 * dice por qué.
 *
 * LO QUE NO COMPRUEBA: que el componente elegido sea el ADECUADO para la forma de
 * esa pantalla. Un `KeyboardScrollView` en un chat compila y se ve mal. Eso se
 * decide leyendo, y va explicado en apps/native/src/ui/keyboard.tsx.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const NATIVE = join(ROOT, 'apps', 'native');
const SKIP = new Set(['node_modules', '.expo', '.turbo', 'dist', 'android', 'ios']);

const WRAPPER_MODULE = '@/ui/keyboard';
const PROVIDER_FILE = 'apps/native/app/_layout.tsx';
const BANNED = 'KeyboardAvoidingView';

/**
 * CENSO. Todo fichero de la app nativa con `<TextInput` va aquí.
 *
 *   use: 'scroll' | 'modal' | 'sticky'  → tiene que importar ese componente
 *   use: null                            → exento, y `why` explica por qué
 */
const SCREENS = {
  // ── Pantallas con formulario dentro de un scroll ──────────────────────────
  'apps/native/app/invite/[token].tsx': { use: 'scroll' },
  'apps/native/app/login.tsx': { use: 'scroll' },
  'apps/native/src/screens/direction/calendario.tsx': { use: 'scroll' },
  'apps/native/src/screens/profile-screen.tsx': { use: 'scroll' },
  'apps/native/src/screens/staff/anuncios.tsx': { use: 'scroll' },
  'apps/native/src/screens/staff/post-partido.tsx': { use: 'scroll' },
  'apps/native/src/screens/staff/sesion-editar.tsx': { use: 'scroll' },

  // ── Diálogos y hojas: el cuadro se aparta del teclado ─────────────────────
  'apps/native/src/screens/forgot-password-modal.tsx': { use: 'modal' },
  'apps/native/src/screens/family/seguidores.tsx': { use: 'modal' },
  'apps/native/src/screens/staff/publish-callup-sheet.tsx': { use: 'modal' },
  'apps/native/src/ui/delete-account-card.tsx': { use: 'modal' },
  'apps/native/src/ui/exercise-picker-sheet.tsx': { use: 'modal' },
  // gestion tiene DOS diálogos con campo (supresión de datos e invitar al menor);
  // su scroll principal no tiene ninguno, y por eso no es 'scroll'.
  'apps/native/src/screens/family/gestion.tsx': { use: 'modal' },

  // ── Barra anclada abajo ───────────────────────────────────────────────────
  'apps/native/src/screens/family/mensaje-detalle.tsx': { use: 'sticky' },

  // ── Exentos, con motivo ───────────────────────────────────────────────────
  'apps/native/src/directo/quick-entry.tsx': {
    use: null,
    why: 'Tarjeta embebida; el scroll lo pone su pantalla (staff/directo.tsx), y ahí es KeyboardScrollView.',
  },
  'apps/native/src/ui/directory-filters.tsx': {
    use: null,
    why: 'Buscador embebido; el scroll lo ponen direction/jugadores.tsx y direction/cuerpo-tecnico.tsx.',
  },
  'apps/native/src/screens/staff/mensaje-nuevo.tsx': {
    use: null,
    why: 'Buscador arriba y resultados en FlatList: no hay nada que apartar, solo keyboardShouldPersistTaps.',
  },
};

/** Pantallas SIN campo propio que cargan con el scroll de un hijo que sí tiene. */
const SCROLL_POR_UN_HIJO = {
  'apps/native/src/screens/staff/directo.tsx': 'Monta QuickEntry, que trae el campo del gol.',
  'apps/native/src/screens/direction/jugadores.tsx': 'Monta DirectoryFilters, que trae el buscador.',
  'apps/native/src/screens/direction/cuerpo-tecnico.tsx': 'Monta DirectoryFilters, que trae el buscador.',
};

const COMPONENTE = { scroll: 'KeyboardScrollView', modal: 'KeyboardModalView', sticky: 'KeyboardStickyBar' };

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];
const ficheros = walk(NATIVE, []);
const rel = (f) => relative(ROOT, f).split(sep).join('/');

// ── [1] El provider ─────────────────────────────────────────────────────────
const layout = readFileSync(join(ROOT, PROVIDER_FILE), 'utf8');
if (!layout.includes('<KeyboardProvider>')) {
  problems.push(
    `· ${PROVIDER_FILE} — falta <KeyboardProvider>. Sin él, KeyboardScrollView, ` +
      'KeyboardModalView y KeyboardStickyBar se montan sin error y no hacen nada.',
  );
}

// ── [2..4] El censo ─────────────────────────────────────────────────────────
const conCampo = [];
for (const f of ficheros) {
  const src = readFileSync(f, 'utf8');
  const r = rel(f);
  if (r === 'apps/native/src/ui/keyboard.tsx') continue;
  if (!src.includes('<TextInput')) continue;
  conCampo.push(r);

  const decl = SCREENS[r];
  if (!decl) {
    problems.push(
      `· ${r} — tiene <TextInput y NO está en el censo de scripts/check-teclado.mjs. ` +
        'Declara qué componente de @/ui/keyboard usa, o por qué está exento.',
    );
    continue;
  }
  const importa = src.includes(WRAPPER_MODULE);
  if (decl.use) {
    const comp = COMPONENTE[decl.use];
    if (!importa || !src.includes(comp)) {
      problems.push(`· ${r} — declara ${comp} y no lo usa.`);
    }
  } else if (importa) {
    problems.push(`· ${r} — declarado EXENTO ("${decl.why}") pero importa ${WRAPPER_MODULE}.`);
  }
}

for (const r of Object.keys(SCREENS)) {
  if (!conCampo.includes(r)) {
    problems.push(`· ${r} — censado pero ya no tiene <TextInput. Bórralo del censo.`);
  }
}

// ── Las pantallas que cargan con el campo de un hijo ────────────────────────
for (const [r, why] of Object.entries(SCROLL_POR_UN_HIJO)) {
  const src = readFileSync(join(ROOT, r), 'utf8');
  if (!src.includes('KeyboardScrollView')) {
    problems.push(`· ${r} — ${why} Tiene que usar KeyboardScrollView y no lo hace.`);
  }
}

// ── [5] La pieza que ya falló, que no vuelva ────────────────────────────────
for (const f of ficheros) {
  const r = rel(f);
  if (r === 'apps/native/src/ui/keyboard.tsx') continue;
  const src = readFileSync(f, 'utf8');
  const lineas = src.split('\n');
  const dentroDeImport = lineas.some(
    (l, i) =>
      l.includes(BANNED) &&
      !/^\s*(\/\/|\/\*|\*)/.test(l) &&
      !l.includes('`') &&
      lineas.slice(Math.max(0, i - 12), i + 1).some((x) => /^import|from 'react-native'/.test(x)),
  );
  if (dentroDeImport) {
    problems.push(
      `· ${r} — vuelve a traer ${BANNED} de react-native. Es la pieza que no funciona ` +
        'en Android (behavior undefined). Usa @/ui/keyboard.',
    );
  }
}

if (problems.length > 0) {
  console.error('\n[teclado] El censo de manejo de teclado NO cuadra:\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\n  Toda pantalla nativa con un campo de texto tiene que decir cómo se aparta del\n' +
      '  teclado. Lee apps/native/src/ui/keyboard.tsx —están las tres formas y cuándo\n' +
      '  usar cada una— y actualiza el censo de scripts/check-teclado.mjs.\n',
  );
  process.exit(1);
}

const usan = Object.values(SCREENS).filter((s) => s.use).length;
const exentos = Object.values(SCREENS).length - usan;
console.log(
  `[teclado] OK — ${conCampo.length} ficheros con campo censados: ${usan} usan @/ui/keyboard, ` +
    `${exentos} exentos con motivo, ${Object.keys(SCROLL_POR_UN_HIJO).length} pantallas cargan con el ` +
    'campo de un hijo, y el KeyboardProvider sigue en el layout raíz.',
);
