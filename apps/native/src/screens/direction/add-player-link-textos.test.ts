import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_LINK_RELATIONS } from '@misterfc/core';

/**
 * W-5 — que "Agregar jugador" no se quede MUDO.
 *
 * Todas las cadenas de esta pantalla se piden por PLANTILLA: el error con
 * `errors.${error}` y la relación con `relation.${r}`. `check:cadenas-muertas` no
 * puede verlo —mira claves SIN USO, no claves QUE FALTAN—, así que lo único que
 * separa un hueco de una clave en crudo en pantalla es este fichero.
 *
 * No es hipotético: en W-3 este mismo test cazó que el modal pedía `club_role.<rol>`
 * a un namespace que solo tiene las dos funciones de entrenador.
 *
 * Y vigila una tercera cosa: que la pantalla siga escribiendo con la sesión del
 * usuario (sin endpoint y sin service-role), que es de donde le viene el candado.
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

function texto(locale: string, ruta: string): string {
  const v = clave(catalogo(locale), ruta);
  expect(typeof v, `${locale}: falta ${ruta}`).toBe('string');
  return v as string;
}

const MODAL = readFileSync(join(__dirname, 'add-player-link-modal.tsx'), 'utf8');
const FICHA = readFileSync(join(__dirname, 'coach-ficha.tsx'), 'utf8');

/**
 * Los códigos se sacan LEYENDO el modal, no importándolo: importar un `.tsx` de la
 * app arrastra `react-native`, que este runner no sabe parsear (`import typeof`). Es
 * el mismo motivo por el que el test de W-3 lee su modal como texto.
 */
function codigosDelModal(): string[] {
  const desde = MODAL.indexOf('CODIGOS_DE_ERROR');
  expect(desde, 'no se encuentra CODIGOS en el modal').toBeGreaterThan(-1);
  const cuerpo = MODAL.slice(desde, MODAL.indexOf('];', desde));
  return [...new Set([...cuerpo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))];
}
const CODIGOS_DE_ERROR = codigosDelModal();

describe('W-5 · los textos de vincular un jugador', () => {
  it('los SEIS desenlaces de core tienen texto en los tres idiomas', () => {
    expect(CODIGOS_DE_ERROR).toHaveLength(6);
    for (const locale of CATALOGOS) {
      for (const code of CODIGOS_DE_ERROR) {
        const v = texto(locale, `cuerpo_tecnico.players.add.errors.${code}`);
        expect(v.trim().length, `${locale}: ${code} vacío`).toBeGreaterThan(0);
      }
    }
  });

  it('la lista de códigos del modal es la de core, sin sobrar ni faltar', () => {
    // Si `LinkPlayerError` gana un desenlace y esta lista no lo recoge, el test de
    // arriba sigue verde y el hueco no lo ve nadie. Por eso se comprueba contra el
    // fichero de core, no contra sí misma.
    const fuente = readFileSync(
      join(RAIZ, 'packages', 'core', 'src', 'staff', 'player-links.ts'),
      'utf8',
    );
    const desde = fuente.indexOf('export type LinkPlayerError');
    expect(desde, 'no se encuentra LinkPlayerError').toBeGreaterThan(-1);
    const cuerpo = fuente.slice(desde, fuente.indexOf(';', desde));
    const deCore = [...cuerpo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...CODIGOS_DE_ERROR].sort()).toEqual(deCore.sort());
  });

  it('las relaciones OFRECIBLES tienen nombre en los tres idiomas', () => {
    for (const locale of CATALOGOS) {
      for (const r of PLAYER_LINK_RELATIONS) {
        expect(
          texto(locale, `cuerpo_tecnico.players.relation.${r}`).trim().length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('`self` también tiene nombre, porque la ficha LEE filas self', () => {
    // Un miembro del club puede ser además jugador adulto con cuenta propia. No se
    // ofrece al escribir, pero se pinta al leer: sin esta clave saldría en crudo.
    expect(FICHA).toContain('cuerpo_tecnico.players.relation.${l.relation}');
    for (const locale of CATALOGOS) {
      expect(texto(locale, 'cuerpo_tecnico.players.relation.self').trim().length).toBeGreaterThan(
        0,
      );
    }
  });

  it('las cadenas propias del modal y de la tarjeta están en los tres idiomas', () => {
    const propias = [
      'add.action',
      'add.title',
      'add.description',
      'add.save',
      'add.cancel',
      'add.close',
      'add.done',
      'add.empty',
      'add.no_match',
      'add.offline',
      'add.field.player',
      'add.field.relation',
      'add.field.search_placeholder',
      'title',
      'empty',
    ];
    for (const locale of CATALOGOS) {
      for (const k of propias) {
        expect(texto(locale, `cuerpo_tecnico.players.${k}`).trim().length).toBeGreaterThan(0);
      }
      expect(
        texto(locale, 'cuerpo_tecnico.players.add.done'),
        `${locale}: 'done' sin {name}`,
      ).toContain('{name}');
    }
  });

  it('el aviso de lista vacía y el de "no coincide" son DISTINTOS', () => {
    // Decirle "no queda ningún jugador por vincular" a quien solo tiene el filtro
    // puesto es mentirle.
    for (const locale of CATALOGOS) {
      expect(texto(locale, 'cuerpo_tecnico.players.add.empty')).not.toBe(
        texto(locale, 'cuerpo_tecnico.players.add.no_match'),
      );
    }
  });
});

describe('W-5 · la escritura y el candado', () => {
  it('escribe con la sesión del usuario: sin endpoint y sin service-role', () => {
    expect(MODAL).toContain('linkPlayerToMember');
    expect(MODAL).not.toContain('callServerEndpoint');
    expect(MODAL).not.toContain('service_role');
  });

  it('el botón lo decide `canLinkPlayers` de core, no un `role ===` escrito aquí', () => {
    expect(FICHA).toContain('canLinkPlayers(');
    expect(FICHA).not.toContain("role === 'admin_club'");
  });

  it('el candado se evalúa antes de pintar el botón de agregar', () => {
    const i = FICHA.indexOf('canLinkPlayers(');
    const j = FICHA.indexOf("t('cuerpo_tecnico.players.add.action')");
    expect(j, 'no se encuentra el botón').toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it('sin red no se escribe (write-guard)', () => {
    expect(MODAL).toContain('if (!online || saving');
  });
});
