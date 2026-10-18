import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * QUIÉN ESTÁ EN EL CAMPO no se decide en una pantalla.
 *
 * El control del directo tenía su propia respuesta: los titulares de la
 * alineación oficial para «quién sale» y el resto de la convocatoria para «quién
 * entra». Era verdad hasta el primer cambio, y a partir de ahí ofrecía sacar a
 * quien ya estaba fuera y no dejaba sacar a quien acababa de entrar. Los minutos
 * jugados se calculan POR esos eventos y acaban en la ficha de cada crío, así que
 * la lista equivocada no se queda en la pantalla.
 *
 * El motor es `deriveSquad` (core) y la lectura `getLiveSquadInputsFromClient`.
 * Lo que vigila esto es que la pantalla siga preguntándoles a ellos.
 *
 * Se mira el CÓDIGO FUENTE y no el render: en esta app las pantallas no se
 * renderizan en los tests (decisión documentada en `player-contact/tutor-rows.ts`).
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const CONTROL = 'src/screens/staff/directo.tsx';
const ENTRADA = 'src/directo/quick-entry.tsx';
const CAMPO = 'src/directo/field-card.tsx';
const DIRECTO_FAMILIA = 'src/screens/family/directo-detalle.tsx';

describe('el once vivo lo resuelve core', () => {
  // ANCLA POSITIVA, primero: si el fichero se moviera o el símbolo se renombrara,
  // las ausencias de abajo saldrían verdes por el motivo equivocado.
  it('el control del directo deriva el once con core', () => {
    const src = leer(CONTROL);
    expect(src).toContain('getLiveSquadInputsFromClient');
    expect(src).toContain('deriveLiveSquad(');
  });

  /**
   * `detail.fieldPlayers` es la alineación OFICIAL (con el override de posiciones
   * vivas, pero sin aplicar un solo cambio). Es lo que pinta la familia y es lo
   * que esta pantalla usaba para decidir. Que no vuelva.
   */
  it('el control NO decide con la alineación oficial', () => {
    expect(leer(CONTROL)).not.toContain('detail.fieldPlayers');
  });

  it('las sustituciones de la COLA entran en el cálculo', () => {
    // Sin esto, el entrenador toca un cambio y las listas no se mueven hasta que
    // la fila sube al servidor — y puede no haber cobertura en todo el partido.
    const src = leer(CONTROL);
    expect(src).toContain('subsPendientes');
    expect(src).toMatch(/deriveLiveSquad\(data\.squad, subsPendientes\)/);
  });

  /**
   * La entrada rápida RECIBE las dos listas y no se las calcula. Antes restaba:
   * `roster` menos los que están en el campo, que es la cuenta que fallaba.
   */
  it('la entrada rápida no se inventa el banquillo', () => {
    const src = leer(ENTRADA);
    expect(src).toContain('enCampo');
    expect(src).toContain('puedenEntrar');
    expect(src).not.toContain('onFieldIds');
    expect(src).not.toMatch(/roster\.filter/);
  });
});

describe('el campo se pinta en UN sitio', () => {
  it('las dos pantallas montan el mismo bloque', () => {
    for (const ruta of [CONTROL, DIRECTO_FAMILIA]) {
      expect(leer(ruta), ruta).toContain('<DirectoFieldCard');
    }
  });

  // El renderizador de campo de verdad es `LineupBoard` (el del editor de
  // alineación). Si una pantalla del directo vuelve a montarlo por su cuenta, hay
  // dos campos que se parecerán cada vez menos.
  it('ninguna pantalla del directo monta el tablero por su cuenta', () => {
    for (const ruta of [CONTROL, DIRECTO_FAMILIA]) {
      expect(leer(ruta), ruta).not.toContain('ReadonlyLineup');
      expect(leer(ruta), ruta).not.toContain('LineupBoard');
    }
    // Y está donde debe: el aserto de arriba pasaría también si nadie lo montara.
    expect(leer(CAMPO)).toContain('ReadonlyLineup');
  });
});
