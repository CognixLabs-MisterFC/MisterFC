import { describe, it, expect } from 'vitest';
import {
  isMatchGoal,
  isOwnGoal,
  canBeOwnGoal,
  computeScore,
  computeShootout,
  isPenaltyOutcome,
  isShootoutOutcome,
  type ScoreEvent,
} from '../score';
import { computePlayerMatchStats, type MatchEventLite } from '../playing-time';

describe('isMatchGoal — qué cuenta como gol del partido', () => {
  it('gol y penalti marcado SÍ; penalti parado/fuera y la tanda NO', () => {
    expect(isMatchGoal({ type: 'goal' })).toBe(true);
    expect(isMatchGoal({ type: 'penalty', outcome: 'scored' })).toBe(true);
    expect(isMatchGoal({ type: 'penalty', outcome: 'saved' })).toBe(false);
    expect(isMatchGoal({ type: 'penalty', outcome: 'missed' })).toBe(false);
    expect(isMatchGoal({ type: 'penalty' })).toBe(false);
    // La tanda nunca cuenta como gol del partido.
    expect(isMatchGoal({ type: 'shootout_penalty', outcome: 'scored' })).toBe(false);
    expect(isMatchGoal({ type: 'shot' })).toBe(false);
  });
});

describe('isOwnGoal — el autogol se reconoce por la FORMA de la fila', () => {
  const AUTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('gol del rival + jugador nuestro = autogol', () => {
    expect(isOwnGoal({ side: 'rival', type: 'goal', playerId: AUTOR })).toBe(true);
  });

  it('el gol del rival por dorsal NO lo es', () => {
    expect(isOwnGoal({ side: 'rival', type: 'goal', playerId: null })).toBe(false);
    expect(isOwnGoal({ side: 'rival', type: 'goal' })).toBe(false);
  });

  it('nuestro gol NO lo es, por mucho jugador que lleve', () => {
    expect(isOwnGoal({ side: 'own', type: 'goal', playerId: AUTOR })).toBe(false);
  });

  it('solo el GOL: la tarjeta o el penalti del rival nunca', () => {
    expect(isOwnGoal({ side: 'rival', type: 'yellow_card', playerId: AUTOR })).toBe(false);
    expect(isOwnGoal({ side: 'rival', type: 'penalty', playerId: AUTOR })).toBe(false);
  });
});

describe('canBeOwnGoal — qué fila ADMITE autor nuestro (la pregunta de la pantalla)', () => {
  const AUTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('solo el gol del rival', () => {
    expect(canBeOwnGoal({ side: 'rival', type: 'goal' })).toBe(true);
    expect(canBeOwnGoal({ side: 'rival', type: 'penalty' })).toBe(false);
    expect(canBeOwnGoal({ side: 'rival', type: 'yellow_card' })).toBe(false);
    expect(canBeOwnGoal({ side: 'own', type: 'goal' })).toBe(false);
  });

  // Las dos preguntas son distintas —«¿puede llevar autor?» y «¿lo lleva?»— y por eso
  // son dos funciones; lo que NO puede pasar es que se separen. Esto fija la relación:
  // una fila es autogol exactamente cuando lo admite Y trae jugador.
  it('isOwnGoal = canBeOwnGoal + jugador, en los cuatro cruces', () => {
    for (const side of ['own', 'rival']) {
      for (const type of ['goal', 'penalty']) {
        for (const playerId of [AUTOR, null]) {
          expect(isOwnGoal({ side, type, playerId })).toBe(
            canBeOwnGoal({ side, type }) && !!playerId,
          );
        }
      }
    }
  });
});

describe('computeScore — marcador por bando (goles + penaltis marcados)', () => {
  it('suma goles y penaltis marcados de cada lado; ignora la tanda', () => {
    const events: ScoreEvent[] = [
      { side: 'own', type: 'goal' },
      { side: 'own', type: 'penalty', outcome: 'scored' },
      { side: 'own', type: 'penalty', outcome: 'saved' }, // no suma
      { side: 'rival', type: 'goal' },
      { side: 'rival', type: 'penalty', outcome: 'missed' }, // no suma
      { side: 'own', type: 'shootout_penalty', outcome: 'scored' }, // tanda, no suma
      { side: 'own', type: 'corner' },
    ];
    expect(computeScore(events)).toEqual({ own: 2, rival: 1 });
  });

  it('sin eventos → 0-0', () => {
    expect(computeScore([])).toEqual({ own: 0, rival: 0 });
  });

  // El autogol NO necesita que `computeScore` se entere de nada: es un gol con
  // `side: 'rival'`, y el marcador ya va por bando. Este test está para que, si
  // alguien convirtiera el autogol en un tipo propio, se ponga rojo aquí.
  it('el AUTOGOL suma al rival, sin saber que es un autogol', () => {
    const events: ScoreEvent[] = [
      { side: 'own', type: 'goal' },
      { side: 'rival', type: 'goal' }, // autogol: la fila es idéntica en el marcador
    ];
    expect(computeScore(events)).toEqual({ own: 1, rival: 1 });
  });
});

describe('computeShootout — tanda: tally por bando + líder', () => {
  it('cuenta marcados y lanzamientos por bando; líder = más marcados', () => {
    const events: ScoreEvent[] = [
      { side: 'own', type: 'shootout_penalty', outcome: 'scored' },
      { side: 'rival', type: 'shootout_penalty', outcome: 'missed' },
      { side: 'own', type: 'shootout_penalty', outcome: 'scored' },
      { side: 'rival', type: 'shootout_penalty', outcome: 'scored' },
      // eventos del partido NO entran en la tanda:
      { side: 'own', type: 'goal' },
      { side: 'own', type: 'penalty', outcome: 'scored' },
    ];
    const t = computeShootout(events);
    expect(t).toEqual({ own: 2, rival: 1, ownTaken: 2, rivalTaken: 2, leader: 'own' });
  });

  it('empate → sin líder (no se puede cerrar la tanda)', () => {
    const events: ScoreEvent[] = [
      { side: 'own', type: 'shootout_penalty', outcome: 'scored' },
      { side: 'rival', type: 'shootout_penalty', outcome: 'scored' },
    ];
    expect(computeShootout(events).leader).toBeNull();
  });

  it('rival por delante → leader rival', () => {
    const events: ScoreEvent[] = [
      { side: 'own', type: 'shootout_penalty', outcome: 'missed' },
      { side: 'rival', type: 'shootout_penalty', outcome: 'scored' },
    ];
    expect(computeShootout(events).leader).toBe('rival');
  });
});

describe('guards de outcome', () => {
  it('isPenaltyOutcome / isShootoutOutcome', () => {
    expect(isPenaltyOutcome('scored')).toBe(true);
    expect(isPenaltyOutcome('saved')).toBe(true);
    expect(isPenaltyOutcome('fuera')).toBe(false);
    expect(isShootoutOutcome('scored')).toBe(true);
    expect(isShootoutOutcome('missed')).toBe(true);
    expect(isShootoutOutcome('saved')).toBe(false); // en la tanda no hay "parado"
  });
});

describe('integración 7.8 — penalti marcado = gol del jugador; tanda no', () => {
  it('un penalti marcado suma a los goles del jugador; la tanda no, y no toca minutos', () => {
    const FULL = 90 * 60;
    const events: MatchEventLite[] = [
      { type: 'goal', playerId: 'A', clockSeconds: 600 },
      { type: 'penalty', playerId: 'A', outcome: 'scored', clockSeconds: 1200 },
      { type: 'penalty', playerId: 'A', outcome: 'saved', clockSeconds: 1800 },
      // tanda: NO cuenta como gol del partido ni toca minutos.
      { type: 'shootout_penalty', playerId: 'A', outcome: 'scored', clockSeconds: FULL },
    ];
    const rows = computePlayerMatchStats({
      starterIds: ['A'],
      events,
      matchClockSeconds: FULL,
      rosterIds: ['A'],
    });
    const a = rows[0]!;
    expect(a.goals).toBe(2); // 1 gol + 1 penalti marcado (el parado y la tanda no)
    expect(a.playedMinutes).toBe(90); // titular todo el partido; los penaltis no tocan minutos
  });
});
