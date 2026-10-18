import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LA PALETA DEL DIRECTO TIENE DOS PISOS, y dónde está cada tipo es una decisión
 * medida, no un accidente.
 *
 * Arriba va lo que se resuelve en dos o tres toques y pasa mientras miras el
 * campo: gol, amarilla, roja, cambio, gol rival, en propia y penalti. Abajo, tras
 * un solo chip, el formulario con los diez tipos del acta.
 *
 * El motivo es de TAMAÑO y está medido sobre estos mismos estilos: en un móvil de
 * 360 de ancho quedan 296 útiles dentro de la tarjeta, y los chips de arriba ya
 * ocupan tres filas. Falta, córner, asistencia, fuera de juego y tiro son los
 * nombres más largos del catálogo: subirlos serían seis filas de paleta antes de
 * poder elegir jugador, en un campo y con una mano.
 *
 * Esto NO es una ley: si mañana se decide subir el córner, este test se pone rojo
 * y esa es toda su función — que la decisión se tome, y no se cuele.
 *
 * Se mira el CÓDIGO FUENTE y no el render: en esta app las pantallas no se
 * renderizan en los tests (decisión documentada en `player-contact/tutor-rows.ts`).
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const PALETA = 'src/directo/quick-entry.tsx';
const CONTROL = 'src/screens/staff/directo.tsx';

describe('primer piso: lo que se apunta en el momento', () => {
  // ANCLA POSITIVA: si el fichero se moviera o la paleta se renombrara, las
  // ausencias de abajo pasarían por el motivo equivocado.
  it('la paleta ofrece gol, tarjetas, cambio, gol rival, en propia y penalti', () => {
    const src = leer(PALETA);
    for (const kind of ['player_goal', 'card', 'substitution', 'rival_goal', 'own_goal', 'penalty'])
      expect(src, kind).toContain(`kind: '${kind}'`);
  });

  /**
   * El penalti no se puede registrar sin resultado: `isMatchGoal` cuenta un
   * penalti SOLO si está marcado, así que una fila sin `outcome` no se podría
   * contar ni como gol ni como fallo. El segundo paso es obligatorio.
   */
  it('el penalti pregunta el RESULTADO antes de registrar', () => {
    const src = leer(PALETA);
    expect(src).toContain('PENALTY_OUTCOMES');
    expect(src).toMatch(/kind: 'penalty', playerId: penaltyPlayer, outcome: o/);
  });

  it.each(['foul', 'corner', 'assist', 'offside', 'shot'])(
    '«%s» NO está en el primer piso',
    (tipo) => {
      expect(leer(PALETA)).not.toContain(`'${tipo}'`);
    },
  );
});

describe('segundo piso: la puerta al formulario de los diez tipos', () => {
  it('la paleta ofrece abrirlo', () => {
    expect(leer(PALETA)).toContain('onMore');
  });

  /**
   * Y el control lo abre EN EL MINUTO DEL RELOJ. Antes, ese formulario solo se
   * alcanzaba tocando un evento ya apuntado: en un partido sin nada en el acta no
   * había forma de llegar a él, que es el callejón que encontró Jose probando el
   * APK («no salen faltas ni penaltis»).
   */
  it('el control lo abre en el minuto actual', () => {
    const src = leer(CONTROL);
    expect(src).toMatch(/onMore=\{\(\) => \{[\s\S]*?setAdding\(minute\);/);
  });
});

describe('el marcador del entrenador cuenta los penaltis', () => {
  /**
   * El marcador de esta pantalla se RE-DERIVA con `computeScore` sobre las filas
   * del servidor más las de la cola, y `computeScore` necesita el `outcome` para
   * saber si un penalti fue gol. Sin llevarlo en la proyección, un penalti marcado
   * no sumaba aquí mientras el detalle del mismo partido —que suma en core desde
   * las filas crudas— sí lo contaba: 1-0 en el móvil del padre y 0-0 en el del
   * entrenador.
   */
  it('las filas de la cola llevan el resultado del penalti', () => {
    expect(leer(CONTROL)).toContain('outcome: r.metadata.outcome');
  });
});
