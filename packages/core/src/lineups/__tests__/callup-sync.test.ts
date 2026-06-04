import { describe, expect, it } from 'vitest';
import {
  calledUpOnPlace,
  calledUpOnRemove,
  groupRosterByCallup,
  type CallupDecision,
} from '../callup-sync';

describe('calledUpOnPlace (BUG 2 — colocar en campo/banquillo → convocado)', () => {
  it('sin decisión y en borrador → inserta called_up', () => {
    expect(calledUpOnPlace(null, false)).toBe('insert_called_up');
  });

  it('ya convocado → noop (idempotente)', () => {
    expect(calledUpOnPlace('called_up', false)).toBe('noop');
  });

  it('descartado → noop (el descarte manda, no se pisa)', () => {
    expect(calledUpOnPlace('discarded', false)).toBe('noop');
  });

  it('convocatoria publicada → noop (regla 6.6, no auto-sync silencioso)', () => {
    expect(calledUpOnPlace(null, true)).toBe('noop');
    expect(calledUpOnPlace('discarded', true)).toBe('noop');
  });
});

describe('calledUpOnRemove (BUG 2 — sacar de la alineación → limpiar)', () => {
  it('borrador → borra called_up (no toca descartes, el DELETE filtra)', () => {
    expect(calledUpOnRemove(false)).toBe('delete_called_up');
  });

  it('publicada → noop (regla 6.6)', () => {
    expect(calledUpOnRemove(true)).toBe('noop');
  });
});

describe('groupRosterByCallup (convocados = roster − descartados)', () => {
  type P = { id: string; decision: CallupDecision | null };
  const decisionOf = (p: P) => p.decision;

  it('convocados = titulares + suplentes + sin decisión; no convocados = descartados', () => {
    const roster: P[] = [
      { id: 'titular', decision: 'called_up' },
      { id: 'suplente-sin-decision', decision: null }, // p.ej. banquillo en convocatoria publicada
      { id: 'descartado', decision: 'discarded' },
      { id: 'suplente-called', decision: 'called_up' },
    ];
    const { calledUp, discarded } = groupRosterByCallup(roster, decisionOf);
    expect(calledUp.map((p) => p.id)).toEqual([
      'titular',
      'suplente-sin-decision',
      'suplente-called',
    ]);
    expect(discarded.map((p) => p.id)).toEqual(['descartado']);
  });

  it('un suplente sin fila called_up NO desaparece: cuenta como convocado', () => {
    const roster: P[] = [{ id: 'banquillo', decision: null }];
    const { calledUp, discarded } = groupRosterByCallup(roster, decisionOf);
    expect(calledUp).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  it('preserva el orden de entrada y no muta el roster', () => {
    const roster: P[] = [
      { id: 'b', decision: null },
      { id: 'a', decision: 'discarded' },
      { id: 'c', decision: 'called_up' },
    ];
    const { calledUp } = groupRosterByCallup(roster, decisionOf);
    expect(calledUp.map((p) => p.id)).toEqual(['b', 'c']);
    expect(roster.map((p) => p.id)).toEqual(['b', 'a', 'c']); // intacto
  });

  it('roster vacío → grupos vacíos', () => {
    const { calledUp, discarded } = groupRosterByCallup([] as P[], decisionOf);
    expect(calledUp).toEqual([]);
    expect(discarded).toEqual([]);
  });
});
