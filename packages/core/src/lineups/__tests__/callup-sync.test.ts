import { describe, expect, it } from 'vitest';
import {
  calledUpOnPlace,
  calledUpOnRemove,
  effectiveCallupDecision,
  groupRosterByCallup,
  callupRatioForPlayer,
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

describe('callupRatioForPlayer (ratio de convocatorias canónico)', () => {
  // Universo de partidos oficiales ya jugados (el caller ya filtró type/fecha).
  const evs = [
    { id: 'e1', starts_at: '2026-01-10T18:00:00.000Z' },
    { id: 'e2', starts_at: '2026-02-10T18:00:00.000Z' },
    { id: 'e3', starts_at: '2026-03-10T18:00:00.000Z' },
  ];
  // Toda la temporada en el equipo.
  const fullSeason = [{ joined_at: '2026-01-01', left_at: null }];

  it('(a) banquillo SIN fila de decisión cuenta como convocado', () => {
    // Sin descartes → convocado en los 3.
    const r = callupRatioForPlayer({
      events: evs,
      memberships: fullSeason,
      discardedEventIds: new Set(),
    });
    expect(r).toEqual({ calledUp: 3, totalMatches: 3 });
  });

  it('(b) descartado en un partido NO cuenta como convocado (pero sí en el total)', () => {
    const r = callupRatioForPlayer({
      events: evs,
      memberships: fullSeason,
      discardedEventIds: new Set(['e2']),
    });
    expect(r).toEqual({ calledUp: 2, totalMatches: 3 });
  });

  it('(c) incorporado a mitad de temporada → denominador solo desde joined_at', () => {
    // Alta el 2026-02-01 → e1 (enero) queda fuera; e2 y e3 dentro.
    const r = callupRatioForPlayer({
      events: evs,
      memberships: [{ joined_at: '2026-02-01', left_at: null }],
      discardedEventIds: new Set(),
    });
    expect(r).toEqual({ calledUp: 2, totalMatches: 2 });
  });

  it('baja a mitad de temporada → partidos posteriores a left_at no cuentan', () => {
    // Baja el 2026-02-15 → e3 (marzo) fuera; e1 y e2 dentro.
    const r = callupRatioForPlayer({
      events: evs,
      memberships: [{ joined_at: '2026-01-01', left_at: '2026-02-15' }],
      discardedEventIds: new Set(['e1']),
    });
    expect(r).toEqual({ calledUp: 1, totalMatches: 2 });
  });

  it('invariante X<=Y: descartar no puede subir convocados por encima del total', () => {
    const r = callupRatioForPlayer({
      events: evs,
      memberships: fullSeason,
      discardedEventIds: new Set(['e1', 'e2', 'e3']),
    });
    expect(r.calledUp).toBeLessThanOrEqual(r.totalMatches);
    expect(r).toEqual({ calledUp: 0, totalMatches: 3 });
  });

  it('varias membresías (baja y re-alta) → cubre las dos ventanas', () => {
    const r = callupRatioForPlayer({
      events: evs,
      memberships: [
        { joined_at: '2026-01-01', left_at: '2026-01-20' }, // cubre e1
        { joined_at: '2026-03-01', left_at: null }, // cubre e3
      ],
      discardedEventIds: new Set(),
    });
    // e2 (febrero) queda en el hueco → fuera.
    expect(r).toEqual({ calledUp: 2, totalMatches: 2 });
  });
});
