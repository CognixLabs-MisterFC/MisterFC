import { describe, it, expect } from 'vitest';
import {
  aggregateTeamStats,
  type PlayerMatchStatRow,
  type RosterPlayer,
} from '../team-aggregate';

function statRow(
  player_id: string,
  over: Partial<PlayerMatchStatRow> = {}
): PlayerMatchStatRow {
  return {
    player_id,
    started: false,
    minutes_played: 0,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    shots: 0,
    fouls_committed: 0,
    fouls_received: 0,
    penalties_scored: 0,
    penalties_missed: 0,
    ...over,
  };
}

function rosterPlayer(
  player_id: string,
  over: Partial<RosterPlayer> = {}
): RosterPlayer {
  return {
    player_id,
    first_name: 'Nombre',
    last_name: 'Apellido',
    dorsal_in_team: null,
    position_in_team: null,
    ...over,
  };
}

describe('aggregateTeamStats', () => {
  it('suma por jugador y devuelve una entrada por miembro del roster', () => {
    const roster = [
      rosterPlayer('p1', { first_name: 'Ana', dorsal_in_team: 10 }),
      rosterPlayer('p2', { first_name: 'Beto', dorsal_in_team: 7 }),
    ];
    const rows = [
      statRow('p1', { started: true, minutes_played: 90, goals: 2 }),
      statRow('p1', { started: true, minutes_played: 80, goals: 1, assists: 1 }),
      statRow('p2', { started: false, minutes_played: 30, goals: 0 }),
    ];

    const { perPlayer } = aggregateTeamStats(roster, rows);

    expect(perPlayer).toHaveLength(2);
    const ana = perPlayer.find((p) => p.player_id === 'p1')!;
    expect(ana.stats.matches).toBe(2);
    expect(ana.stats.starts).toBe(2);
    expect(ana.stats.minutesPlayed).toBe(170);
    expect(ana.stats.goals).toBe(3);
    expect(ana.stats.assists).toBe(1);

    const beto = perPlayer.find((p) => p.player_id === 'p2')!;
    expect(beto.stats.matches).toBe(1);
    expect(beto.stats.starts).toBe(0);
    expect(beto.stats.goals).toBe(0);
  });

  it('incluye a los jugadores del roster sin partidos con stats a cero', () => {
    const roster = [rosterPlayer('p1'), rosterPlayer('sin-juego')];
    const rows = [statRow('p1', { minutes_played: 45 })];

    const { perPlayer } = aggregateTeamStats(roster, rows);

    const sinJuego = perPlayer.find((p) => p.player_id === 'sin-juego')!;
    expect(sinJuego.stats.matches).toBe(0);
    expect(sinJuego.stats.minutesPlayed).toBe(0);
    // ratio sobre 0 partidos = null (la UI pinta "—").
    expect(sinJuego.ratios.goalsPerMatch).toBeNull();
    expect(sinJuego.ratios.startRate).toBeNull();
  });

  it('los totales del equipo son la SUMA de los agregados del roster', () => {
    const roster = [rosterPlayer('p1'), rosterPlayer('p2')];
    const rows = [
      statRow('p1', { started: true, minutes_played: 90, goals: 1, assists: 2 }),
      statRow('p2', { started: true, minutes_played: 90, goals: 3, assists: 0 }),
      statRow('p2', { started: false, minutes_played: 20, goals: 0, yellow_cards: 1 }),
    ];

    const { totals, perPlayer } = aggregateTeamStats(roster, rows);

    expect(totals.matches).toBe(3);
    expect(totals.starts).toBe(2);
    expect(totals.minutesPlayed).toBe(200);
    expect(totals.goals).toBe(4);
    expect(totals.assists).toBe(2);
    expect(totals.yellowCards).toBe(1);

    // Invariante: totals == Σ perPlayer.stats (campo a campo en goles).
    const sumGoals = perPlayer.reduce((a, p) => a + p.stats.goals, 0);
    expect(sumGoals).toBe(totals.goals);
  });

  it('calcula los ratios del equipo SOBRE los totales, no como media de medias', () => {
    // p1: 1 gol en 90 min (goles/90 = 1.0). p2: 0 goles en 10 min (goles/90 = 0).
    // Media de medias = 0.5. Sobre agregados = 1·90/100 = 0.9 → debe dar 0.9.
    const roster = [rosterPlayer('p1'), rosterPlayer('p2')];
    const rows = [
      statRow('p1', { started: true, minutes_played: 90, goals: 1 }),
      statRow('p2', { started: false, minutes_played: 10, goals: 0 }),
    ];

    const { totalsRatios } = aggregateTeamStats(roster, rows);

    // 1 gol · 90 / 100 min = 0.9 (NO 0.5).
    expect(totalsRatios.goalsPer90).toBeCloseTo(0.9, 6);
    // 1 gol / 2 partidos = 0.5.
    expect(totalsRatios.goalsPerMatch).toBeCloseTo(0.5, 6);
    // 1 titular / 2 partidos = 0.5.
    expect(totalsRatios.startRate).toBeCloseTo(0.5, 6);
  });

  it('multi-equipo: las filas de un jugador en este equipo se suman (caso roster del team)', () => {
    // El helper opera por team (season-scoped): todas las filas que recibe son
    // de ESTE equipo. Varias filas del mismo jugador → se suman.
    const roster = [rosterPlayer('p1')];
    const rows = [
      statRow('p1', { minutes_played: 90, goals: 1 }),
      statRow('p1', { minutes_played: 90, goals: 1 }),
      statRow('p1', { minutes_played: 45, goals: 2 }),
    ];

    const { perPlayer, totals } = aggregateTeamStats(roster, rows);

    const p1 = perPlayer.find((p) => p.player_id === 'p1')!;
    expect(p1.stats.matches).toBe(3);
    expect(p1.stats.goals).toBe(4);
    expect(totals.goals).toBe(4);
  });

  it('roster y filas vacíos → totales a cero y ratios null', () => {
    const { perPlayer, totals, totalsRatios } = aggregateTeamStats([], []);
    expect(perPlayer).toHaveLength(0);
    expect(totals.matches).toBe(0);
    expect(totals.goals).toBe(0);
    expect(totalsRatios.goalsPerMatch).toBeNull();
    expect(totalsRatios.goalsPer90).toBeNull();
  });

  it('ignora filas de jugadores que no están en el roster (defensivo)', () => {
    const roster = [rosterPlayer('p1')];
    const rows = [
      statRow('p1', { goals: 1 }),
      statRow('intruso', { goals: 5 }),
    ];

    const { perPlayer, totals } = aggregateTeamStats(roster, rows);

    expect(perPlayer).toHaveLength(1);
    expect(totals.goals).toBe(1); // el gol del intruso no cuenta
  });

  it('conserva el orden del roster en perPlayer', () => {
    const roster = [
      rosterPlayer('c', { dorsal_in_team: 3 }),
      rosterPlayer('a', { dorsal_in_team: 1 }),
      rosterPlayer('b', { dorsal_in_team: 2 }),
    ];
    const { perPlayer } = aggregateTeamStats(roster, []);
    expect(perPlayer.map((p) => p.player_id)).toEqual(['c', 'a', 'b']);
  });
});
