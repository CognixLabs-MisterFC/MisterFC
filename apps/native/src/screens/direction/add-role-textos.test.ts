import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAM_STAFF_ROLES } from '@misterfc/core';

/**
 * W-2 — que "Agregar rol" no se quede MUDO en ningún desenlace.
 *
 * Por qué hace falta un test y no basta el guard: el modal pinta los errores y las
 * funciones con PLANTILLAS —`t(`…errors.${error}`)` y `t(`staff_role.${r}`)`— y
 * `check:cadenas-muertas` mira claves SIN USO, no claves QUE FALTAN. Una clave
 * ausente ahí no rompe el build ni el guard: sale en pantalla como texto crudo, y
 * justo en el momento en que alguien acaba de fallar una asignación.
 *
 * Se lee el fichero del modal en vez de importarlo: importar el .tsx arrastraría
 * react-native al entorno de Node. Lo que se comprueba es la LISTA declarada, que es
 * la que decide qué textos se pueden llegar a pedir.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
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

const FUENTE = readFileSync(join(__dirname, 'add-role-modal.tsx'), 'utf8');

/** Los códigos del array `ERRORES` del modal, leídos del propio fichero. */
function codigosDeclarados(): string[] {
  const desde = FUENTE.indexOf('const ERRORES = [');
  expect(desde, 'no se encuentra el array ERRORES en el modal').toBeGreaterThan(-1);
  const hasta = FUENTE.indexOf('] as const;', desde);
  return [...FUENTE.slice(desde, hasta).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('W-2 · los textos de agregar rol', () => {
  it('el modal declara los siete desenlaces', () => {
    // Si el endpoint gana un código nuevo, esta lista tiene que crecer con él; si no,
    // el modal lo enseñará como `generic` (que es seguro, pero menos útil).
    expect(codigosDeclarados()).toEqual([
      'team_invalid',
      'staff_role_invalid',
      'cross_club',
      'principal_exists',
      'role_exists',
      'forbidden',
      'generic',
    ]);
  });

  it('cada código tiene texto en los tres idiomas', () => {
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const code of codigosDeclarados()) {
        const v = clave(cat, `cuerpo_tecnico.add_role.errors.${code}`);
        expect(typeof v, `${locale}: falta cuerpo_tecnico.add_role.errors.${code}`).toBe(
          'string',
        );
        expect((v as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('cada función de team_staff tiene nombre en los tres idiomas', () => {
    // El selector puede ofrecer cualquiera de TEAM_STAFF_ROLES (al director, las cinco).
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const rol of TEAM_STAFF_ROLES) {
        const v = clave(cat, `staff_role.${rol}`);
        expect(typeof v, `${locale}: falta staff_role.${rol}`).toBe('string');
      }
    }
  });

  it('las cadenas propias del modal están en los tres idiomas', () => {
    const propias = ['action', 'title', 'description', 'save', 'saving', 'cancel', 'close', 'done', 'no_teams', 'offline'];
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const k of propias) {
        const v = clave(cat, `cuerpo_tecnico.add_role.${k}`);
        expect(typeof v, `${locale}: falta cuerpo_tecnico.add_role.${k}`).toBe('string');
      }
    }
    // Y `done` lleva el nombre de la persona: sin el marcador, el mensaje se queda
    // en un "ya tiene esa función" sin sujeto.
    for (const locale of CATALOGOS) {
      const v = clave(catalogo(locale), 'cuerpo_tecnico.add_role.done') as string;
      expect(v, `${locale}: 'done' sin {name}`).toContain('{name}');
    }
  });

  it('el modal pide los textos por el mismo prefijo que la web', () => {
    // Si alguien renombra el namespace en el modal, los textos siguen existiendo y el
    // guard de cadenas muertas no dice nada: el error solo se ve en pantalla.
    expect(FUENTE).toContain("t('cuerpo_tecnico.add_role.title')");
    expect(FUENTE).toContain('cuerpo_tecnico.add_role.errors.${error}');
  });
});
