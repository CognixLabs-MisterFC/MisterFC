import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AREA_SEGMENT,
  AREA_SWITCH_LOOK,
  AREA_TABS,
  PUBLIC_ROUTE_SEGMENTS,
  SUBSCRIPTION_EXEMPT_SEGMENTS,
  SWITCH_TAB_NAME,
  allMenuFiles,
  hasSwitchTab,
  hrefFor,
  isPublicRoute,
  isSubscriptionExemptRoute,
  type ChromeArea,
} from './config';
import { AREA_SWITCH_ORDER } from '@misterfc/core';

/**
 * Rutas públicas del guard de sesión.
 *
 * Lo que se protege aquí es el fallo que dejó la app en blanco: el guard expulsa
 * al login toda ruta que no sea pública, así que una ruta que se pinta sin sesión
 * y NO está en la lista entra en bucle con el login — sin excepción, sin crash y
 * sin evento en Sentry. Es un fallo mudo, y por eso conviene que algo lo mire.
 */
describe('isPublicRoute', () => {
  it('el login es público', () => {
    expect(isPublicRoute(['login'])).toBe(true);
  });

  it('el selector de club es público', () => {
    // La que faltaba. Sin esto, el login redirige al selector y el guard lo
    // devuelve al login: bucle infinito y pantalla en blanco.
    expect(isPublicRoute(['seleccionar-club'])).toBe(true);
  });

  it('las áreas con sesión NO son públicas', () => {
    for (const area of ['family', 'staff', 'direction', 'spectator']) {
      expect(isPublicRoute([area])).toBe(false);
    }
  });

  it('una subruta de una pública también lo es', () => {
    // El guard mira `segments[0]`: si mañana el selector tiene un segundo nivel,
    // no hay que volver a tocar la lista.
    expect(isPublicRoute(['seleccionar-club', 'lo-que-sea'])).toBe(true);
  });

  it('la raíz NO es pública', () => {
    // `segments` vacío = `/`, donde vive el gatekeeper, que ya redirige solo.
    expect(isPublicRoute([])).toBe(false);
  });

  it('una ruta inventada no es pública', () => {
    expect(isPublicRoute(['ruta-que-no-existe'])).toBe(false);
  });
});

describe('la lista de rutas públicas apunta a rutas REALES', () => {
  // Una errata en la lista ('seleccionar_club' con guion bajo, por ejemplo) no
  // da error de compilación ni de lint: deja la ruta fuera y devuelve la pantalla
  // en blanco. Aquí se comprueba contra el árbol de ficheros de expo-router.
  it.each([...PUBLIC_ROUTE_SEGMENTS])('«%s» existe en app/', (segment) => {
    const appDir = join(__dirname, '..', '..', 'app');
    const comoFichero = join(appDir, `${segment}.tsx`);
    const comoCarpeta = join(appDir, segment);
    const existe =
      existsSync(comoFichero) ||
      (existsSync(comoCarpeta) && statSync(comoCarpeta).isDirectory());
    expect(existe).toBe(true);
  });
});

/**
 * SU-4 — rutas exentas del MURO DE PAGO.
 *
 * Mismo fallo mudo que las públicas, una vuelta más arriba: si el muro empuja a
 * `/suscripcion` una ruta que no está exenta, y `/suscripcion` tampoco lo está, el
 * guard se redirige a sí mismo. Un bucle de navegación no lanza excepciones: la app se
 * queda en blanco, sin crash, sin Sentry y sin CI en rojo.
 */
describe('isSubscriptionExemptRoute', () => {
  it('el muro está exento de sí mismo (si no, es un bucle)', () => {
    expect(isSubscriptionExemptRoute(['suscripcion'])).toBe(true);
  });

  it('la confirmación del borrado está exenta', () => {
    expect(isSubscriptionExemptRoute(['cuenta-eliminada'])).toBe(true);
  });

  it.each(['login', 'seleccionar-club'])('%s está exenta: nunca se empuja hacia atrás a quien entra', (seg) => {
    expect(isSubscriptionExemptRoute([seg])).toBe(true);
  });

  it('la raíz está exenta: ahí decide el gatekeeper', () => {
    expect(isSubscriptionExemptRoute([])).toBe(true);
  });

  // Decisión 3 de Jose: sin suscripción no se ve NADA del producto.
  it.each(['family', 'staff', 'direction', 'spectator'])('el área %s NO está exenta', (seg) => {
    expect(isSubscriptionExemptRoute([seg])).toBe(false);
  });

  // Y `perfil` tampoco: exentarlo abriría media app de familia. El borrado sigue
  // alcanzable porque su tarjeta vive DENTRO de la pantalla del muro.
  it('perfil NO está exento', () => {
    expect(isSubscriptionExemptRoute(['family', 'perfil'])).toBe(false);
    expect(isSubscriptionExemptRoute(['perfil'])).toBe(false);
  });

  it('cuenta por SEGMENTO de primer nivel, como el guard', () => {
    expect(isSubscriptionExemptRoute(['suscripcion', 'loquesea'])).toBe(true);
  });

  // Toda ruta exenta tiene que ser un fichero de verdad: una entrada que no exista es
  // una exención que no protege nada.
  it('cada segmento exento existe como ruta', () => {
    const appDir = join(process.cwd(), 'app');
    for (const seg of SUBSCRIPTION_EXEMPT_SEGMENTS) {
      const asFile = join(appDir, `${seg}.tsx`);
      const asDir = join(appDir, seg);
      const ok =
        (existsSync(asFile) && statSync(asFile).isFile()) ||
        (existsSync(asDir) && statSync(asDir).isDirectory());
      expect(ok, `falta la ruta ${seg}`).toBe(true);
    }
  });
});

/**
 * Cada fichero de ruta de un área se declara EXACTAMENTE una vez.
 *
 * `AreaNavigator` monta tres listas de `Tabs.Screen`: las pestañas de la barra
 * (`AREA_TABS`), el conmutador de área y el resto como `href:null`
 * (`allMenuFiles`). expo-router declara por su cuenta todo fichero que el layout
 * NO declare, y lo hace como PESTAÑA: un fichero olvidado no da error de tipos ni
 * de lint, simplemente aparece una pestaña de más en la barra de todo el mundo.
 * Y declararlo dos veces (mismo `name`) revienta el navegador.
 *
 * Lo comprobamos contra el árbol de ficheros real, que es lo único que expo-router
 * mira. Es el fallo que casi se cuela con el modo tutor: `app/family/rol.tsx` solo
 * se muestra a quien tiene hijos vinculados, así que sin declararlo con href:null
 * en el resto de casos habría salido como 5ª pestaña a TODAS las familias.
 */
describe('declaración de rutas por área', () => {
  const AREAS: ChromeArea[] = ['family', 'staff', 'direction', 'spectator'];

  /** Nombres de ruta declarados por el navegador para un área (con repetidos). */
  function declaredNames(area: ChromeArea): string[] {
    return [
      ...AREA_TABS[area].map((t) => t.name),
      // Un solo fichero por área, y el mismo nombre en las tres: el destino del
      // conmutador ya no es fijo, así que el fichero no puede llamarse como uno.
      ...(hasSwitchTab(area) ? [SWITCH_TAB_NAME] : []),
      ...allMenuFiles(area).map((m) => m.name),
    ];
  }

  /** Ficheros de ruta reales del área (sin `_layout`). */
  function routeFiles(area: ChromeArea): string[] {
    const dir = join(process.cwd(), 'app', AREA_SEGMENT[area]);
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => e.name.replace(/\.tsx$/, ''))
      .filter((n) => n !== '_layout');
  }

  it.each(AREAS)('«%s»: ningún fichero se declara dos veces', (area) => {
    const names = declaredNames(area);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `declarados dos veces: ${dupes.join(', ')}`).toEqual([]);
  });

  it.each(AREAS)('«%s»: todo fichero de ruta está declarado', (area) => {
    const declared = new Set(declaredNames(area));
    const olvidados = routeFiles(area).filter((n) => !declared.has(n));
    expect(
      olvidados,
      `saldrían como pestaña sin pedirlo: ${olvidados.join(', ')}`,
    ).toEqual([]);
  });

  it.each(AREAS)('«%s»: todo lo declarado existe como fichero', (area) => {
    const files = new Set(routeFiles(area));
    const fantasmas = declaredNames(area).filter((n) => !files.has(n));
    expect(fantasmas, `declaradas sin fichero: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('las tres áreas que rotan tienen su fichero de conmutador, el seguidor no', () => {
    // El conmutador es UN botón con destino variable, así que el fichero se llama
    // igual en todas (`rol`). Si a un área le faltara, expo-router no declararía nada
    // y el botón sería un hueco; si el seguidor lo tuviera, le saldría una pestaña que
    // no lleva a ninguna parte.
    for (const area of AREAS) {
      const existe = existsSync(
        join(process.cwd(), 'app', AREA_SEGMENT[area], `${SWITCH_TAB_NAME}.tsx`),
      );
      expect(existe, `${area}: fichero del conmutador`).toBe(hasSwitchTab(area));
    }
  });
});

/**
 * ASPECTO del conmutador. El anillo (a dónde se va) lo decide core y se prueba allí;
 * aquí solo se comprueba que la app sepa PINTAR cada parada de ese anillo. Un destino
 * sin entrada en `AREA_SWITCH_LOOK` no da error de tipos si alguien amplía el anillo
 * con un `as`: sale una pestaña sin rótulo ni icono.
 */
describe('aspecto del conmutador', () => {
  it('cada parada del anillo tiene rótulo e icono', () => {
    for (const area of AREA_SWITCH_ORDER) {
      const look = AREA_SWITCH_LOOK[area];
      expect(look, `falta el aspecto de ${area}`).toBeDefined();
      expect(look.labelKey).toMatch(/^nav\./);
      expect(look.icon.length).toBeGreaterThan(0);
    }
  });

  it('las tres paradas se distinguen entre sí', () => {
    // Dos destinos con el mismo icono o el mismo rótulo hacen que el botón parezca
    // el mismo botón mientras lleva a sitios distintos.
    const looks = AREA_SWITCH_ORDER.map((a) => AREA_SWITCH_LOOK[a]);
    expect(new Set(looks.map((l) => l.icon)).size).toBe(AREA_SWITCH_ORDER.length);
    expect(new Set(looks.map((l) => l.labelKey)).size).toBe(AREA_SWITCH_ORDER.length);
  });

  it('cada parada es un área con carcasa de verdad', () => {
    for (const area of AREA_SWITCH_ORDER) {
      expect(AREA_SEGMENT[area]).toBeDefined();
      expect(hrefFor(area, 'index')).toBe(`/${AREA_SEGMENT[area]}`);
    }
  });
});
