import { describe, expect, it } from 'vitest';
import {
  MODALITY_RULES,
  calledUpLimitApplies,
  calledUpOverflow,
  exceedsStarters,
  maxCalledUpFor,
  modalityRules,
  startersFor,
  lineupEmptyAction,
} from '../rules';
import { fieldCapacity } from '../geometry';
import { TEAM_FORMATS } from '../types';
import { getFormation } from '../formations';

describe('reglas por modalidad', () => {
  it('starters coincide con el nº de slots del preset de esa modalidad', () => {
    expect(startersFor('F5')).toBe(fieldCapacity(getFormation('1-2-2')!)); // 5
    expect(startersFor('F7')).toBe(fieldCapacity(getFormation('1-3-3')!)); // 7
    expect(startersFor('F8')).toBe(fieldCapacity(getFormation('1-3-3-1')!)); // 8
    expect(startersFor('F11')).toBe(fieldCapacity(getFormation('4-3-3')!)); // 11
  });

  it('starters + maxBench = maxCalledUp en cada modalidad', () => {
    // TEAM_FORMATS y no una lista de aquí: una modalidad nueva entra sola.
    for (const fmt of TEAM_FORMATS) {
      const r = modalityRules(fmt);
      expect(r.starters + r.maxBench).toBe(r.maxCalledUp);
    }
  });

  it('valores esperados', () => {
    // F5: querubines, cuatro de campo más portero y quince convocados.
    expect(MODALITY_RULES.F5).toEqual({ starters: 5, maxCalledUp: 15, maxBench: 10 });
    expect(MODALITY_RULES.F7).toEqual({ starters: 7, maxCalledUp: 12, maxBench: 5 });
    expect(MODALITY_RULES.F8).toEqual({ starters: 8, maxCalledUp: 14, maxBench: 6 });
    expect(MODALITY_RULES.F11).toEqual({ starters: 11, maxCalledUp: 18, maxBench: 7 });
  });

  it('calledUpOverflow devuelve el sobrante o 0', () => {
    expect(calledUpOverflow(12, 'F7')).toBe(0);
    expect(calledUpOverflow(13, 'F7')).toBe(1);
    expect(calledUpOverflow(16, 'F8')).toBe(2);
    expect(calledUpOverflow(10, 'F11')).toBe(0);
    expect(maxCalledUpFor('F8')).toBe(14);
  });

  // F13B — el tope de convocados solo aplica al partido oficial.
  it('calledUpLimitApplies: solo match topa; friendly/tournament no', () => {
    expect(calledUpLimitApplies('match')).toBe(true);
    expect(calledUpLimitApplies('friendly')).toBe(false);
    expect(calledUpLimitApplies('tournament')).toBe(false);
    expect(calledUpLimitApplies('training')).toBe(false);
  });

  it('F13B: un amistoso NO bloquea aunque supere maxCalledUp; un oficial sí', () => {
    // Replica la decisión de checkCalledUpLimit: si el tope aplica, hay bloqueo
    // cuando calledUpOverflow > 0; si no aplica (friendly/tournament), nunca.
    const wouldBlock = (type: string, count: number, format: 'F7' | 'F8' | 'F11') =>
      calledUpLimitApplies(type) && calledUpOverflow(count, format) > 0;

    // 20 convocados en F11 (max 18) → sobra 2.
    expect(calledUpOverflow(20, 'F11')).toBe(2);
    // Oficial: bloquea. Amistoso/torneo: NO, aunque supere el máximo.
    expect(wouldBlock('match', 20, 'F11')).toBe(true);
    expect(wouldBlock('friendly', 20, 'F11')).toBe(false);
    expect(wouldBlock('tournament', 20, 'F11')).toBe(false);
    // Oficial dentro del tope: no bloquea.
    expect(wouldBlock('match', 18, 'F11')).toBe(false);
  });

  it('exceedsStarters: tope de titulares por modalidad (Bug F)', () => {
    // F7=7, F8=8, F11=11 titulares.
    expect(exceedsStarters(7, 'F7')).toBe(false);
    expect(exceedsStarters(8, 'F7')).toBe(true);
    expect(exceedsStarters(8, 'F8')).toBe(false);
    expect(exceedsStarters(9, 'F8')).toBe(true);
    expect(exceedsStarters(11, 'F11')).toBe(false);
    expect(exceedsStarters(12, 'F11')).toBe(true);
  });
});

/**
 * lineupEmptyAction — qué ofrece la pantalla cuando el partido no tiene alineación.
 *
 * La app nativa pintaba la MISMA frase sin salida al entrenador que podía crearla y
 * al que no. Esta es la decisión que lo arregla, y vive aquí porque en el JSX de la
 * nativa no la mediría nadie: ese paquete no tiene tests de componente.
 */
describe('lineupEmptyAction', () => {
  it('la tabla entera: 4 combinaciones → 3 estados', () => {
    expect(lineupEmptyAction({ canManage: true, online: true })).toBe('create');
    expect(lineupEmptyAction({ canManage: true, online: false })).toBe('create_offline');
    expect(lineupEmptyAction({ canManage: false, online: true })).toBe('no_permission');
    expect(lineupEmptyAction({ canManage: false, online: false })).toBe('no_permission');
  });

  it('sin permiso manda el permiso, no la red: con red y sin ella dice lo mismo', () => {
    // Si esto se invirtiera, a quien no gestiona la alineación se le diría que el
    // problema es la conexión y volvería a intentarlo para siempre.
    expect(lineupEmptyAction({ canManage: false, online: true })).toBe(
      lineupEmptyAction({ canManage: false, online: false }),
    );
  });

  it('los tres estados son distintos entre sí (ninguno es alias de otro)', () => {
    const estados = new Set([
      lineupEmptyAction({ canManage: true, online: true }),
      lineupEmptyAction({ canManage: true, online: false }),
      lineupEmptyAction({ canManage: false, online: true }),
    ]);
    expect(estados.size).toBe(3);
  });
});
