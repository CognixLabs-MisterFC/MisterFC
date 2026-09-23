import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * La plantilla de un equipo la pintan DOS áreas con la misma pantalla, y solo una
 * puede abrir la ficha del jugador:
 *
 *   · DIRECCIÓN — ficha club-wide de solo lectura, la misma a la que llega desde
 *     el menú → Jugadores. Es su trabajo.
 *   · FAMILIA — aquí están los COMPAÑEROS del hijo. Abrirles la ficha sería
 *     enseñarle a un padre los datos del hijo de otro.
 *
 * La capacidad la trae quien monta la pantalla (`onOpenPlayer`), no la pantalla.
 * Esto lo vigila: el día que alguien cablee la navegación en el sitio compartido —o
 * se la pase a familia «para que quede igual»— sale en rojo aquí y no en la app de
 * una familia.
 *
 * Se mira el CÓDIGO FUENTE y no el render: en esta app las pantallas no se
 * renderizan en los tests (decisión documentada en `player-contact/tutor-rows.ts`),
 * y lo que hay que vigilar es justamente quién pasa el prop.
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const DIRECCION = 'app/direction/equipo-plantilla.tsx';
const FAMILIA = 'app/family/plantilla.tsx';
const COMPARTIDA = 'src/screens/family/plantilla.tsx';

describe('plantilla compartida — quién puede abrir la ficha', () => {
  // ANCLA POSITIVA, primero: si el fixture midiera mal (fichero movido, prop
  // renombrada), las ausencias de abajo saldrían verdes por el motivo equivocado.
  it('dirección SÍ pasa onOpenPlayer, y lleva a la ficha de dirección', () => {
    const src = leer(DIRECCION);
    expect(src).toContain('onOpenPlayer');
    expect(src).toContain('/direction/jugador');
  });

  it('la pantalla compartida acepta el prop y no navega por su cuenta', () => {
    const src = leer(COMPARTIDA);
    expect(src).toContain('onOpenPlayer');
    // No importa el router: si lo hiciera, podría navegar sin que nadie se lo pida.
    expect(src).not.toMatch(/from 'expo-router'/);
    expect(src).not.toContain('router.push');
  });

  it('familia NO lo pasa: los compañeros del hijo no son pulsables', () => {
    expect(leer(FAMILIA)).not.toContain('onOpenPlayer');
  });

  it('familia tampoco navega a una ficha por su cuenta', () => {
    const src = leer(FAMILIA);
    expect(src).not.toContain('router.push');
    expect(src).not.toContain('jugador');
  });
});
