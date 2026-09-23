import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AREA_SEGMENT,
  PUBLIC_ROUTE_SEGMENTS,
  isPublicRoute,
  isSubscriptionExemptRoute,
} from './config';

/**
 * ESCALÓN 1 — el bucle de redirecciones que deja la app EN BLANCO (#559).
 *
 * El fallo original: `/login` redirigía a `/seleccionar-club`, que no estaba en
 * `PUBLIC_ROUTE_SEGMENTS`, así que el `SessionGuard` la devolvía al login. Login →
 * selector → login → … Un bucle de navegación **no lanza ninguna excepción**: la
 * pantalla se queda en blanco, no llega nada a Sentry y ningún job de CI lo ve,
 * porque ninguno ejecuta una navegación. Se descubrió a mano, mirando la app.
 *
 * Lo que se comprueba aquí es la forma del fallo, no aquel caso concreto:
 *
 *   desde una ruta alcanzable SIN SESIÓN, todo destino tiene que ser público
 *   —o la raíz, que es el único sitio autorizado a decidir—.
 *
 * La raíz (`/`) es la excepción legítima y está razonada: ahí vive el gatekeeper
 * (`app/index.tsx`), que redirige por su cuenta y sin sesión manda al login. Por eso
 * `isPublicRoute([])` es `false` a propósito y aquí se trata aparte. Un `login` que
 * va a `/` no es un bucle: solo lo hace cuando YA tiene sesión.
 *
 * Y se comprueba la misma forma una vuelta más arriba, con el MURO DE PAGO
 * (`isSubscriptionExemptRoute`): una ruta exenta que empuja a una no exenta es el
 * mismo bucle mudo, y es de donde saldrá el próximo si sale alguno.
 *
 * Se lee el árbol de ficheros de `app/`, que es lo único que ve expo-router. NO se
 * simula navegación: esto no sustituye a probar la app, atrapa la clase de error que
 * nadie va a ver a tiempo.
 */

/** Raíz de rutas de expo-router. `process.cwd()` es apps/native al correr vitest. */
const APP_DIR = join(process.cwd(), 'app');

/** La raíz: el gatekeeper. Único destino no público permitido desde una ruta pública. */
const GATEKEEPER = '/';

type Redireccion = {
  /** Fichero que redirige, relativo a `app/` (para que el fallo diga dónde mirar). */
  fichero: string;
  /** Segmentos de la ruta de ESE fichero (`[]` = la raíz). */
  origen: string[];
  /** Destino absoluto (`/login`, `/family`…). */
  destino: string;
};

/** Todos los `.tsx` bajo `app/`, recursivo. */
function ficherosDeRuta(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) ficherosDeRuta(p, acc);
    else if (e.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

/**
 * Segmentos de la ruta que sirve un fichero, con el criterio de expo-router: se cae
 * `.tsx`, `index` no añade segmento y `_layout` sirve la ruta de su carpeta (los
 * guards viven en los layouts, así que su origen es el de las pantallas que envuelve).
 */
function segmentosDe(abs: string): string[] {
  const rel = relative(APP_DIR, abs).replace(/\.tsx$/, '');
  return rel
    .split(sep)
    .filter((s) => s !== 'index' && s !== '_layout');
}

/**
 * Destinos que sabemos leer:
 *  · literal — `<Redirect href="/x" />`, `router.replace('/x')`;
 *  · con parámetros — `router.push({ pathname: '/x', params: {…} })`, que es como
 *    navegan las pantallas que llevan un id (la ficha de un jugador desde la
 *    plantilla de un equipo). El destino es el `pathname`; los params no cambian a
 *    qué ruta se va, así que no se miran;
 *  · plantilla sobre `AREA_SEGMENT` — la del gatekeeper: `` `/${AREA_SEGMENT.spectator}` ``
 *    y `` `/${AREA_SEGMENT[area]}` ``, que se expande a las CUATRO áreas.
 *
 * Cualquier otra forma se devuelve en `ilegibles` y pone el test en ROJO. Es
 * deliberado: un destino que este test no sabe leer es un destino que no está
 * vigilado, y preferimos que lo diga a que calle. Si algún día hace falta uno
 * dinámico de verdad, se enseña a leerlo aquí (o se razona la excepción).
 */
function destinosDe(texto: string): { destinos: string[]; ilegibles: string[] } {
  const destinos: string[] = [];
  const ilegibles: string[] = [];
  const AREAS = Object.values(AREA_SEGMENT).map((s) => `/${s}`);

  const crudos: string[] = [];
  for (const m of texto.matchAll(/<Redirect\b[^>]*?href\s*=\s*([^\s>]+)/gs)) {
    crudos.push(m[1] ?? '');
  }
  // El primer alternante coge la forma de OBJETO entera (hasta la primera llave de
  // cierre, que basta para ver el `pathname`); el segundo, la de siempre.
  for (const m of texto.matchAll(
    /router\.(?:replace|push|navigate)\(\s*(\{[\s\S]*?\}|[^\s)]+)/g,
  )) {
    crudos.push(m[1] ?? '');
  }

  for (const crudo of crudos) {
    const literal = /^\{?["'](\/[^"']*)["']/.exec(crudo);
    if (literal?.[1]) {
      destinos.push(literal[1]);
      continue;
    }
    // `router.push({ pathname: '/x', params: {…} })` → el destino es el pathname.
    const conPathname = /^\{[\s\S]*?pathname\s*:\s*["'](\/[^"']*)["']/.exec(crudo);
    if (conPathname?.[1]) {
      destinos.push(conPathname[1]);
      continue;
    }
    // `/${AREA_SEGMENT.spectator}` → una; `/${AREA_SEGMENT[algo]}` → las cuatro.
    if (/^\{?`\/\$\{AREA_SEGMENT\./.test(crudo)) {
      const concreta = /AREA_SEGMENT\.([A-Za-z]+)/.exec(crudo)?.[1];
      const seg = concreta
        ? (AREA_SEGMENT as Record<string, string | undefined>)[concreta]
        : undefined;
      destinos.push(seg ? `/${seg}` : '');
      continue;
    }
    if (/^\{?`\/\$\{AREA_SEGMENT\[/.test(crudo)) {
      destinos.push(...AREAS);
      continue;
    }
    ilegibles.push(crudo);
  }
  return { destinos, ilegibles };
}

const FICHEROS = ficherosDeRuta(APP_DIR);

const REDIRECCIONES: Redireccion[] = [];
const ILEGIBLES: { fichero: string; crudo: string }[] = [];
for (const abs of FICHEROS) {
  const fichero = relative(APP_DIR, abs);
  const { destinos, ilegibles } = destinosDe(readFileSync(abs, 'utf8'));
  for (const destino of destinos) {
    REDIRECCIONES.push({ fichero, origen: segmentosDe(abs), destino });
  }
  for (const crudo of ilegibles) ILEGIBLES.push({ fichero, crudo });
}

/** ¿`/x` existe como ruta (fichero o carpeta) en el árbol de expo-router? */
function destinoExiste(destino: string): boolean {
  if (destino === GATEKEEPER) return true; // app/index.tsx
  const segs = destino.replace(/^\//, '').split('/').filter(Boolean);
  if (segs.length === 0) return false;
  const comoFichero = join(APP_DIR, `${segs.join(sep)}.tsx`);
  const comoCarpeta = join(APP_DIR, segs.join(sep));
  return (
    existsSync(comoFichero) ||
    (existsSync(comoCarpeta) && statSync(comoCarpeta).isDirectory())
  );
}

describe('redirecciones de app/ · el censo', () => {
  // CONTROL POSITIVO. Sin esto, un regex que dejara de casar daría 0 redirecciones y
  // TODO lo de abajo pasaría en verde sin haber comprobado nada. El silencio no es
  // un aprobado: si este número baja de golpe, es que el lector se ha roto.
  it('encuentra las redirecciones que hay (control positivo)', () => {
    expect(REDIRECCIONES.length).toBeGreaterThanOrEqual(10);
    expect(FICHEROS.length).toBeGreaterThan(50);
  });

  it('sabe leer TODOS los destinos: ninguno se queda sin vigilar', () => {
    expect(
      ILEGIBLES,
      `destinos que este test no sabe leer (enséñale la forma nueva o razona la ` +
        `excepción; mientras, no están vigilados): ` +
        ILEGIBLES.map((i) => `${i.fichero} → ${i.crudo}`).join(' · '),
    ).toEqual([]);
  });

  it('todo destino apunta a una ruta que EXISTE', () => {
    // Un `href="/selecionar-club"` con una errata no da error de tipos ni de lint:
    // da pantalla en blanco.
    const fantasmas = REDIRECCIONES.filter((r) => !destinoExiste(r.destino));
    expect(
      fantasmas.map((r) => `${r.fichero} → ${r.destino}`),
      'redirigen a una ruta que no existe',
    ).toEqual([]);
  });
});

describe('redirecciones de app/ · el bucle con el SessionGuard (#559)', () => {
  it('desde una ruta pública, todo destino es público o la raíz', () => {
    const publicas = REDIRECCIONES.filter((r) => isPublicRoute(r.origen));
    // Control: si mañana nadie redirige desde una ruta pública, esta comprobación
    // no afirmaría nada. Hoy redirigen login, cuenta-eliminada e invite.
    expect(publicas.length).toBeGreaterThanOrEqual(3);

    const malas = publicas.filter(
      (r) =>
        r.destino !== GATEKEEPER &&
        !isPublicRoute(r.destino.replace(/^\//, '').split('/').filter(Boolean)),
    );
    expect(
      malas.map((r) => `${r.fichero} → ${r.destino}`),
      `bucle con el SessionGuard: sin sesión, estas rutas se ven, redirigen a un ` +
        `destino NO público y el guard las devuelve. Pantalla en blanco, sin ` +
        `excepción y sin Sentry. O el destino entra en PUBLIC_ROUTE_SEGMENTS, o la ` +
        `redirección no puede ocurrir sin sesión`,
    ).toEqual([]);
  });

  it('el gatekeeper manda al login cuando no hay sesión, y el login es público', () => {
    // Es el otro extremo de la excepción de la raíz: `/` puede ser destino de una
    // ruta pública PORQUE sin sesión resuelve a una ruta pública. Si esto cambiara,
    // la excepción dejaría de estar justificada.
    const raiz = REDIRECCIONES.filter((r) => r.origen.length === 0);
    expect(raiz.map((r) => r.destino)).toContain('/login');
    expect(isPublicRoute(['login'])).toBe(true);
  });

  it('cada segmento público sigue siendo una ruta real', () => {
    // Duplica a propósito lo que ya mira config.test.ts: aquí la lista se usa como
    // criterio de un bucle, así que si un segmento tuviera una errata, esta suite
    // aprobaría por el motivo equivocado.
    for (const seg of PUBLIC_ROUTE_SEGMENTS) {
      expect(destinoExiste(`/${seg}`), `la ruta pública ${seg} no existe`).toBe(true);
    }
  });
});

describe('redirecciones de app/ · el mismo bucle con el MURO DE PAGO', () => {
  it('desde una ruta exenta del muro, todo destino es exento o la raíz', () => {
    // Mismo fallo mudo una vuelta más arriba (SU-4): si el muro empuja a
    // `/suscripcion` una ruta no exenta y esa vuelve a empujar, es un bucle.
    //
    // El GATEKEEPER queda fuera como origen, por la misma razón por la que vale como
    // destino: es el único fichero que decide, y decide MIRANDO el muro antes de
    // mandar a nadie a un área (el test de abajo comprueba que lo mira de verdad, para
    // que esta excepción no se sostenga sobre una suposición). Sin esta exclusión, las
    // cuatro áreas a las que reparte saldrían marcadas, que es ruido, no un bucle.
    const exentas = REDIRECCIONES.filter(
      (r) => r.origen.length > 0 && isSubscriptionExemptRoute(r.origen),
    );
    expect(exentas.length).toBeGreaterThanOrEqual(3);

    const malas = exentas.filter(
      (r) =>
        r.destino !== GATEKEEPER &&
        !isSubscriptionExemptRoute(r.destino.replace(/^\//, '').split('/').filter(Boolean)),
    );
    expect(
      malas.map((r) => `${r.fichero} → ${r.destino}`),
      'bucle con el muro de pago: ruta exenta que empuja a un destino no exento',
    ).toEqual([]);
  });

  it('el gatekeeper MIRA el muro antes de repartir (lo que justifica su excepción)', () => {
    // La excepción del gatekeeper vale porque consulta la suscripción y pinta el muro
    // él mismo. Si alguien le quitara esa consulta, el fichero seguiría repartiendo a
    // las cuatro áreas sin mirar nada y la excepción pasaría a tapar un agujero real.
    const fuente = readFileSync(join(APP_DIR, 'index.tsx'), 'utf8');
    expect(fuente).toContain('useSubscription');
    expect(fuente).toContain('PaywallScreen');
    // Y lo mira ANTES de decidir el área: el muro aparece en el fichero por delante
    // del reparto por área (`AREA_SEGMENT`).
    expect(fuente.indexOf('subscription.blocked')).toBeGreaterThan(-1);
    expect(fuente.indexOf('subscription.blocked')).toBeLessThan(
      fuente.indexOf('AREA_SEGMENT['),
    );
  });
});
