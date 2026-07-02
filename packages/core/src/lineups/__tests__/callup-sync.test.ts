import { describe, expect, it } from 'vitest';
import {
  calledUpOnPlace,
  calledUpOnRemove,
  effectiveCallupDecision,
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

// Marcador por jugador del detalle de convocatoria (DecisionButtons.initial):
// el botón "Convocado" debe resaltarse aunque el jugador NO tenga fila
// called_up. Regla canónica escalar: sin fila / called_up → convocado; solo
// discarded → descartado. Regresión del bug "el banquillo no queda convocado".
describe('effectiveCallupDecision (marcador por jugador = regla canónica)', () => {
  it('sin fila (banquillo sembrado) → CONVOCADO (called_up)', () => {
    expect(effectiveCallupDecision(null)).toBe('called_up');
  });

  it('fila called_up explícita (titular) → CONVOCADO', () => {
    expect(effectiveCallupDecision('called_up')).toBe('called_up');
  });

  it('fila discarded → DESCARTADO', () => {
    expect(effectiveCallupDecision('discarded')).toBe('discarded');
  });

  it('coincide con groupRosterByCallup (misma regla, un solo origen)', () => {
    type P = { id: string; decision: CallupDecision | null };
    const roster: P[] = [
      { id: 'titular', decision: 'called_up' },
      { id: 'banquillo', decision: null },
      { id: 'descartado', decision: 'discarded' },
    ];
    const { calledUp, discarded } = groupRosterByCallup(
      roster,
      (p) => p.decision,
    );
    const calledUpIds = calledUp.map((p) => p.id);
    const discardedIds = discarded.map((p) => p.id);
    for (const p of roster) {
      const eff = effectiveCallupDecision(p.decision);
      if (eff === 'discarded') expect(discardedIds).toContain(p.id);
      else expect(calledUpIds).toContain(p.id);
    }
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

// Contador DERIVADO de "Gestión de partidos": replica cómo lo usa
// loadCallupMatches — rosterIds (vigente) + Set de descartados. Garantiza:
// banquillo (sin fila) cuenta; descartado del roster no; descartado que YA NO
// está en el roster no resta (no aparece en rosterIds).
describe('contador derivado de la lista (roster vigente − descartados ∩ roster)', () => {
  const countCalledUp = (rosterIds: string[], discarded: Set<string>) =>
    groupRosterByCallup(rosterIds, (pid) =>
      discarded.has(pid) ? 'discarded' : null
    );

  it('banquillo (sin fila called_up) cuenta como convocado', () => {
    const { calledUp } = countCalledUp(
      ['titular', 'banquillo'],
      new Set<string>() // ninguna decisión
    );
    expect(calledUp).toEqual(['titular', 'banquillo']);
    expect(calledUp).toHaveLength(2);
  });

  it('descartado del roster no cuenta como convocado', () => {
    const { calledUp, discarded } = countCalledUp(
      ['titular', 'banquillo', 'fuera'],
      new Set(['fuera'])
    );
    expect(calledUp).toEqual(['titular', 'banquillo']);
    expect(discarded).toEqual(['fuera']);
  });

  it('descartado que ya NO está en el roster no resta', () => {
    // 'ex' está descartado pero ya dejó el equipo → no está en rosterIds.
    const { calledUp, discarded } = countCalledUp(
      ['titular', 'banquillo'],
      new Set(['ex'])
    );
    expect(calledUp).toEqual(['titular', 'banquillo']); // 2, no 1
    expect(discarded).toEqual([]); // 'ex' no aparece
  });
});
