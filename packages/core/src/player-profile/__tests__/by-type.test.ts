import { describe, expect, it } from 'vitest';
import {
  classifyMatchType,
  splitMatchStatsByType,
  type MatchStatRowTyped,
} from '../by-type';

/** Fila base con stats "1 de todo" para verificar el reparto por grupo. */
function row(
  eventType: string,
  tournamentId: string | null,
  over: Partial<MatchStatRowTyped> = {},
): MatchStatRowTyped {
  return {
    started: true,
    minutes_played: 90,
    goals: 1,
    assists: 1,
    yellow_cards: 1,
    red_cards: 0,
    shots: 2,
    fouls_committed: 1,
    fouls_received: 1,
    penalties_scored: 0,
    penalties_missed: 0,
    eventType,
    tournamentId,
    ...over,
  };
}

describe('classifyMatchType (regla F9B)', () => {
  it('oficial = match sin tournament_id', () => {
    expect(classifyMatchType('match', null)).toBe('oficial');
  });

  it('torneo = match CON tournament_id (sub-partido)', () => {
    expect(classifyMatchType('match', 'tour-1')).toBe('torneo');
  });

  it('amistoso = friendly', () => {
    expect(classifyMatchType('friendly', null)).toBe('amistoso');
  });

  it("ignora 'other'/'training' (no es partido)", () => {
    expect(classifyMatchType('other', null)).toBeNull();
    expect(classifyMatchType('training', null)).toBeNull();
    // friendly nunca lleva tournament_id, pero si lo llevara sigue siendo amistoso
    expect(classifyMatchType('friendly', 'x')).toBe('amistoso');
  });
});

describe('splitMatchStatsByType (Total/Oficial/Amistoso/Torneo)', () => {
  it('un sub-partido de torneo va a Torneo, NO a Oficial', () => {
    const s = splitMatchStatsByType([row('match', 'tour-1')]);
    expect(s.torneo.matches).toBe(1);
    expect(s.oficial.matches).toBe(0);
    expect(s.amistoso.matches).toBe(0);
    expect(s.total.matches).toBe(1);
  });

  it('un oficial puro va a Oficial', () => {
    const s = splitMatchStatsByType([row('match', null)]);
    expect(s.oficial.matches).toBe(1);
    expect(s.torneo.matches).toBe(0);
  });

  it('un friendly va a Amistoso', () => {
    const s = splitMatchStatsByType([row('friendly', null)]);
    expect(s.amistoso.matches).toBe(1);
    expect(s.oficial.matches).toBe(0);
  });

  it('Total = suma de los tres grupos (métricas agregadas)', () => {
    const s = splitMatchStatsByType([
      row('match', null, { goals: 2 }), // oficial
      row('friendly', null, { goals: 3 }), // amistoso
      row('match', 'tour-1', { goals: 4 }), // torneo
    ]);
    expect(s.oficial.goals).toBe(2);
    expect(s.amistoso.goals).toBe(3);
    expect(s.torneo.goals).toBe(4);
    expect(s.total.goals).toBe(9);
    expect(s.total.matches).toBe(3);
    // starts se agrega igual que sumMatchStats (todas started=true).
    expect(s.total.starts).toBe(3);
  });

  it("ignora 'other'/'training': no cuentan en ningún grupo ni en Total", () => {
    const s = splitMatchStatsByType([
      row('match', null), // oficial
      row('other', null, { goals: 99 }), // ignorada
      row('training', null, { goals: 99 }), // ignorada
    ]);
    expect(s.oficial.matches).toBe(1);
    expect(s.total.matches).toBe(1);
    expect(s.total.goals).toBe(1); // el 99 de 'other'/'training' NO entra
  });

  it('array vacío → todos los grupos a cero', () => {
    const s = splitMatchStatsByType([]);
    expect(s.total.matches).toBe(0);
    expect(s.oficial.matches).toBe(0);
    expect(s.amistoso.matches).toBe(0);
    expect(s.torneo.matches).toBe(0);
    expect(s.total.goals).toBe(0);
  });
});
