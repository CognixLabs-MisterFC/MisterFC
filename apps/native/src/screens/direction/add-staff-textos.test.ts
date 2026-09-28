import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, TEAM_STAFF_ROLES } from '@misterfc/core';

/**
 * W-3 — que "Añadir staff" no se quede MUDO, y que la pantalla compartida siga
 * compartida sin filtrar gestión a las familias.
 *
 * Dos cosas distintas se vigilan aquí:
 *
 *  1. LOS TEXTOS. El modal traduce los códigos del endpoint a las claves de ESTE
 *     namespace con una tabla (el endpoint dice `invalid`, aquí se llama
 *     `membership_invalid`). Una entrada mal escrita en esa tabla no rompe nada: sale
 *     la clave en crudo en pantalla. Y `check:cadenas-muertas` no puede verlo, porque
 *     mira claves SIN USO, no claves QUE FALTAN.
 *
 *  2. EL AISLAMIENTO. `CuerpoTecnicoScreen` la comparten familia y dirección. La
 *     acción tiene que entrar por prop desde la ruta de dirección, y la de familia NO
 *     debe pasarla. Un descuido ahí le pone a los padres un botón de gestión.
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

const MODAL = readFileSync(join(__dirname, 'add-staff-modal.tsx'), 'utf8');
const RUTA_DIRECCION = readFileSync(
  join(RAIZ, 'apps', 'native', 'app', 'direction', 'equipo-cuerpo-tecnico.tsx'),
  'utf8',
);
const RUTA_FAMILIA = readFileSync(
  join(RAIZ, 'apps', 'native', 'app', 'family', 'cuerpo-tecnico.tsx'),
  'utf8',
);
const PANTALLA = readFileSync(
  join(RAIZ, 'apps', 'native', 'src', 'screens', 'family', 'cuerpo-tecnico.tsx'),
  'utf8',
);

/** Los DESTINOS de la tabla de traducción de errores, leídos del propio modal. */
function destinosDeError(): string[] {
  const desde = MODAL.indexOf('const TEXTO_DE_ERROR');
  expect(desde, 'no se encuentra TEXTO_DE_ERROR en el modal').toBeGreaterThan(-1);
  const hasta = MODAL.indexOf('};', desde);
  const cuerpo = MODAL.slice(desde, hasta);
  return [...new Set([...cuerpo.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
}

describe('W-3 · los textos de añadir staff', () => {
  it('la tabla traduce a claves que EXISTEN en los tres idiomas', () => {
    const destinos = destinosDeError();
    expect(destinos.length).toBeGreaterThanOrEqual(8);
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const k of destinos) {
        const v = clave(cat, `staff.add.errors.${k}`);
        expect(typeof v, `${locale}: falta staff.add.errors.${k}`).toBe('string');
        expect((v as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('cubre los códigos que el endpoint puede devolver', () => {
    // Si el endpoint gana un código, la tabla tiene que nombrarlo o el mensaje sale
    // como `generic` (seguro, pero menos útil).
    const cuerpo = MODAL.slice(MODAL.indexOf('const TEXTO_DE_ERROR'));
    for (const code of [
      'invalid',
      'staff_role_invalid',
      'team_invalid',
      'cross_club',
      'principal_exists',
      'role_exists',
      'forbidden',
      'generic',
    ]) {
      expect(cuerpo, `la tabla no nombra ${code}`).toContain(`${code}:`);
    }
  });

  it('un código desconocido cae en generic, no en una clave inventada', () => {
    expect(MODAL).toContain("|| 'generic'");
  });

  it('las cadenas propias del modal están en los tres idiomas', () => {
    const propias = ['action', 'title', 'description', 'save', 'saving', 'cancel', 'close', 'done', 'empty', 'offline'];
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const k of propias) {
        expect(typeof clave(cat, `staff.add.${k}`), `${locale}: falta staff.add.${k}`).toBe(
          'string',
        );
      }
      expect(clave(cat, 'staff.add.done') as string, `${locale}: 'done' sin {name}`).toContain(
        '{name}',
      );
    }
  });

  it('los roles que puede pintar el modal tienen nombre en los tres idiomas', () => {
    // Funciones de equipo en los chips, y rol de club junto a cada candidato.
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const r of TEAM_STAFF_ROLES) {
        expect(typeof clave(cat, `staff_role.${r}`), `${locale}: staff_role.${r}`).toBe('string');
      }
      // `roles` y no `club_role`: aquí los candidatos pueden ser admin_club,
      // director o coordinador, y `club_role` solo tiene las dos de entrenador.
      // Este test cazó exactamente eso antes de que lo viera nadie.
      for (const r of STAFF_ROLES) {
        expect(typeof clave(cat, `roles.${r}`), `${locale}: roles.${r}`).toBe('string');
      }
      expect(MODAL, 'el modal debe pedir el rol de club por `roles.`').toContain(
        'roles.${c.clubRole}',
      );
    }
  });
});

describe('W-3 · la pantalla compartida no filtra gestión a familia', () => {
  it('la acción entra por PROP, no está escrita dentro de la pantalla', () => {
    expect(PANTALLA).not.toContain('AddStaffAction');
    expect(PANTALLA).toContain('action?:');
  });

  it('la ruta de DIRECCIÓN sí la pasa', () => {
    expect(RUTA_DIRECCION).toContain('AddStaffAction');
    expect(RUTA_DIRECCION).toContain('action=');
  });

  it('la ruta de FAMILIA no la pasa, ni la menciona', () => {
    // Éste es el test que de verdad protege a los padres.
    expect(RUTA_FAMILIA).not.toContain('AddStaffAction');
    expect(RUTA_FAMILIA).not.toContain('action=');
  });

  it('el candado se decide antes de pintar el botón', () => {
    // No vale enseñar el botón y que el servidor diga no: a un coordinador se le
    // ofrecería un 42501 en cada equipo que no coordina.
    expect(MODAL).toContain('canAssignStaffToTeam');
    const i = MODAL.indexOf('canAssignStaffToTeam(viewerRole');
    const j = MODAL.indexOf("t('staff.add.action')");
    expect(i, 'no se llama al candado con el rol de quien mira').toBeGreaterThan(-1);
    expect(i, 'el candado tiene que ir ANTES del botón').toBeLessThan(j);
  });
});
