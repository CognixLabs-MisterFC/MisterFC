import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEEP_LINK_LOCALES, OPEN_IN_BROWSER_SEGMENT, openInBrowserPath } from '@misterfc/core';

/**
 * N-3b — el boton que abre la invitacion de TUTOR en el navegador.
 *
 * Lo que vigila este fichero es lo que ni el typecheck ni un render verian:
 *
 *  1. QUE EL BOTON ABRA LA RUTA ABRIDORA Y NO LA RECLAMADA. Es el fallo entero de
 *     N-3: `/{locale}/invite/{token}` la reclama esta misma app, asi que abrirla con
 *     `Linking.openURL` devuelve al tutor a la pantalla de la que viene. Cambiar el
 *     enlace a la ruta reclamada compilaria, pasaria los tests de tipos y solo se
 *     notaria en un movil. Aqui no.
 *  2. QUE EL CAMINO SALGA DE CORE. Escrito a mano en la pantalla, se queda atras el
 *     dia que cambie el segmento — el modo de fallo silencioso de todo lo de deep
 *     links.
 *  3. QUE HAYA TEXTO, en los tres idiomas. Una clave que falta se pinta en crudo.
 *  4. QUE UN `openURL` RECHAZADO no se tragu. Un boton que no hace nada y no dice
 *     nada es peor que no tener boton: antes por lo menos estaba el enlace copiable.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const CATALOGOS = ['es', 'en', 'va'] as const;

function catalogo(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(RAIZ, 'messages', `${locale}.json`), 'utf8'));
}

function clave(obj: Record<string, unknown>, ruta: string): unknown {
  let cur: unknown = obj;
  for (const p of ruta.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const PANTALLA = readFileSync(
  join(RAIZ, 'apps', 'native', 'app', 'invite', '[token].tsx'),
  'utf8',
);

/** El trozo que construye el enlace del veredicto que manda al navegador. */
function trozoDelEnlace(): string {
  const i = PANTALLA.indexOf('const enlace =');
  expect(i, 'no encuentro donde se construye el enlace').toBeGreaterThan(-1);
  return PANTALLA.slice(i, PANTALLA.indexOf(';', i) + 1);
}

describe('N-3b · el boton abre la ruta ABRIDORA, no la reclamada', () => {
  it('el enlace se construye con `openInBrowserPath`, de core', () => {
    expect(PANTALLA).toContain("openInBrowserPath");
    expect(trozoDelEnlace()).toContain('openInBrowserPath(locale, token)');
  });

  it('NO se construye la ruta reclamada a mano', () => {
    // Este es EL test. `/${locale}/invite/${token}` es lo que habia antes y lo que
    // devolveria al tutor a esta misma pantalla.
    expect(trozoDelEnlace()).not.toContain('/invite/');
  });

  it('el segmento que usa core no es el reclamado', () => {
    for (const locale of DEEP_LINK_LOCALES) {
      expect(openInBrowserPath(locale, 'abc')).toBe(`/${locale}/${OPEN_IN_BROWSER_SEGMENT}/abc`);
      expect(openInBrowserPath(locale, 'abc')).not.toContain('/invite/');
    }
  });

  it('la base sigue saliendo de `webBaseUrl()`, que es lo que hace fiable a `error_no_web_url`', () => {
    expect(trozoDelEnlace()).toContain('webBaseUrl()');
    // Y el guard de que exista sigue delante: sin base, no hay enlace ni boton.
    expect(trozoDelEnlace()).toContain('&& webBaseUrl()');
  });

  it('solo se ofrece cuando el veredicto manda al navegador', () => {
    expect(trozoDelEnlace()).toContain('preflightMandaAlNavegador(code)');
  });
});

describe('N-3b · el boton y su respaldo', () => {
  it('abre con `Linking.openURL`, que ya usa esta pantalla para lo legal', () => {
    expect(PANTALLA).toContain('Linking.openURL(enlace)');
  });

  it('un `openURL` rechazado NO se traga: cambia el rotulo y pide copiar', () => {
    expect(PANTALLA).toContain('.catch(() => setFalloAlAbrir(true))');
    expect(PANTALLA).toContain("linkLabel={falloAlAbrir ? t('open_failed') : t('link_to_copy')}");
  });

  it('el enlace copiable SIGUE ahi como respaldo', () => {
    expect(PANTALLA).toContain('selectable');
  });

  it('y `expo-clipboard` se queda FUERA: no se importa ni es dependencia', () => {
    // La primera version de este test buscaba la cadena 'expo-clipboard' en la
    // pantalla y cazaba el COMENTARIO que explica por que no se usa: medía la
    // palabra, no el hecho. Lo que importa es el import y el package.json.
    expect(PANTALLA).not.toContain("from 'expo-clipboard'");
    const pkg = JSON.parse(
      readFileSync(join(RAIZ, 'apps', 'native', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('expo-clipboard');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('expo-clipboard');
  });

  it('ancla positiva: el package.json que se lee es el de la app', () => {
    // Sin esto, un fichero mal leido daria «no esta» para cualquier cosa.
    const pkg = JSON.parse(
      readFileSync(join(RAIZ, 'apps', 'native', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toContain('expo-linking');
  });

  it('sin enlace no se pinta boton', () => {
    expect(PANTALLA).toContain('openLabel={enlace ?');
  });
});

describe('N-3b · los textos, en los tres idiomas', () => {
  it('el boton y el aviso de fallo existen y no estan vacios', () => {
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const k of ['open_in_browser', 'open_failed', 'link_to_copy']) {
        const v = clave(cat, `invite.${k}`);
        expect(typeof v, `${locale}: falta invite.${k}`).toBe('string');
        expect((v as string).trim().length, `${locale}: ${k} vacia`).toBeGreaterThan(0);
      }
    }
  });

  it('los tres idiomas dicen cosas distintas: nadie dejo el castellano pegado', () => {
    const porIdioma = CATALOGOS.map((l) => clave(catalogo(l), 'invite.open_in_browser'));
    expect(new Set(porIdioma).size).toBeGreaterThan(1);
  });

  it('el rotulo del respaldo ya NO manda abrir el navegador: eso lo hace el boton', () => {
    // Con boton, «mantén pulsado para copiarlo Y ábrelo en el navegador» decia dos
    // veces lo mismo y contradecia al boton de encima.
    const es = clave(catalogo('es'), 'invite.link_to_copy') as string;
    expect(es.toLowerCase()).not.toContain('navegador');
  });
});
