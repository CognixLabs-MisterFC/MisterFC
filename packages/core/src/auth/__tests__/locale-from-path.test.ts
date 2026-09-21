import { describe, it, expect } from 'vitest';
import { localeFromPath } from '../auth-callback';

/**
 * De qué idioma devolver a alguien cuando `/auth/callback` falla.
 *
 * Existe porque ese redirect estaba escrito a mano como `/es/signin`: a quien tiene
 * la app en valenciano o en inglés se le contestaba en castellano SIEMPRE. El mensaje
 * de «no hemos podido completar el acceso» habría nacido inalcanzable en dos de los
 * tres idiomas.
 */

const LOCALES = ['es', 'en', 'va'] as const;
const loc = (p: string | null) => localeFromPath(p, LOCALES, 'es');

describe('localeFromPath · lo que sabe leer', () => {
  it('saca el idioma del primer segmento', () => {
    expect(loc('/va/reset-password')).toBe('va');
    expect(loc('/en/invite/abc-123')).toBe('en');
    expect(loc('/es/')).toBe('es');
  });

  it('una ruta de un solo segmento de idioma tambien vale', () => {
    expect(loc('/va')).toBe('va');
  });

  it('el idioma solo se lee del PRIMER segmento', () => {
    // `/invite/va/...` no es valenciano: es una ruta sin idioma que lleva "va" dentro.
    expect(loc('/invite/va/token')).toBe('es');
  });
});

describe('localeFromPath · cuando no se puede saber', () => {
  it('sin ruta, el de por defecto', () => {
    expect(loc(null)).toBe('es');
    expect(loc('')).toBe('es');
  });

  it('la raiz no dice nada: es el caso «ni artefactos ni destino»', () => {
    expect(loc('/')).toBe('es');
  });

  it('un primer segmento que no es idioma cae en el de por defecto', () => {
    expect(loc('/reset-password')).toBe('es');
    expect(loc('/fr/algo')).toBe('es');
    expect(loc('/ES/algo')).toBe('es'); // no se normaliza: la lista manda
  });

  it('lo que no empieza por barra no es una ruta de este sitio', () => {
    // Ni absolutas ni protocol-relative: `safeNextPath` ya las descarta antes, pero
    // esto no depende de que lo haya hecho.
    expect(loc('https://misterfc.es/va/x')).toBe('es');
    expect(loc('//malo.es/va/x')).toBe('es');
    expect(loc('va/reset-password')).toBe('es');
  });
});

describe('localeFromPath · la lista de idiomas la pone quien llama', () => {
  it('con otra lista, otro resultado', () => {
    // La lista de verdad vive en la config de next-intl de web. Aqui se comprueba que
    // de verdad se usa la que llega, y no una copia escondida dentro de la funcion.
    expect(localeFromPath('/fr/algo', ['fr', 'es'], 'es')).toBe('fr');
    expect(localeFromPath('/va/algo', ['fr', 'es'], 'es')).toBe('es');
  });

  it('el de por defecto tambien lo pone quien llama', () => {
    expect(localeFromPath('/', LOCALES, 'en')).toBe('en');
  });
});
