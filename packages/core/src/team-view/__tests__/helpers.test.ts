import { describe, it, expect } from 'vitest';
import {
  listTeammates,
  listUpcomingTeamEvents,
  listVisibleAnnouncements,
} from '../helpers';

describe('listTeammates', () => {
  const players = [
    { id: 'p1', first_name: 'Ana', last_name: 'Ruiz', dorsal: 10, photo_url: null },
    { id: 'p2', first_name: 'Beto', last_name: null, dorsal: 7, photo_url: null },
    { id: 'p3', first_name: 'Carmen', last_name: 'Diaz', dorsal: null, photo_url: null },
    { id: 'p4', first_name: 'Diego', last_name: 'Alba', dorsal: 2, photo_url: null },
  ];

  it('excluye al jugador actual', () => {
    const r = listTeammates(players, 'p1');
    expect(r.map((p) => p.id)).toEqual(['p4', 'p2', 'p3']);
  });

  it('ordena por dorsal asc, sin dorsal al final, alfabético tras eso', () => {
    const r = listTeammates(players, 'p1');
    expect(r[0]?.dorsal).toBe(2);
    expect(r[1]?.dorsal).toBe(7);
    expect(r[2]?.dorsal).toBeNull();
  });

  it('full_name maneja last_name null', () => {
    const r = listTeammates(players, 'p1');
    const beto = r.find((p) => p.id === 'p2')!;
    expect(beto.full_name).toBe('Beto');
  });

  it('lista vacía si solo está el actual', () => {
    expect(listTeammates([players[0]!], 'p1')).toEqual([]);
  });

  it('lista vacía si players vacíos', () => {
    expect(listTeammates([], 'p1')).toEqual([]);
  });
});

describe('listUpcomingTeamEvents', () => {
  const now = '2026-05-31T12:00:00.000Z';
  const events = [
    { id: 'e1', title: 'Pasado', type: 'training', starts_at: '2026-05-30T18:00:00.000Z', ends_at: null, location_name: null, opponent_name: null },
    { id: 'e2', title: 'Hoy futuro', type: 'training', starts_at: '2026-05-31T18:00:00.000Z', ends_at: null, location_name: null, opponent_name: null },
    { id: 'e3', title: 'En 5 días', type: 'match', starts_at: '2026-06-05T16:00:00.000Z', ends_at: null, location_name: null, opponent_name: null },
    { id: 'e4', title: 'En 40 días (fuera de horizon 30)', type: 'training', starts_at: '2026-07-10T18:00:00.000Z', ends_at: null, location_name: null, opponent_name: null },
  ];

  it('filtra pasados y respeta horizon', () => {
    const r = listUpcomingTeamEvents(events, now);
    expect(r.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('ordena por starts_at asc', () => {
    const r = listUpcomingTeamEvents(events, now);
    expect(r[0]?.id).toBe('e2');
    expect(r[1]?.id).toBe('e3');
  });

  it('respeta limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      title: `t${i}`,
      type: 'training',
      starts_at: new Date(Date.parse(now) + (i + 1) * 3600_000).toISOString(),
      ends_at: null,
      location_name: null,
      opponent_name: null,
    }));
    const r = listUpcomingTeamEvents(many, now, 30, 5);
    expect(r).toHaveLength(5);
  });

  it('horizon configurable', () => {
    const r = listUpcomingTeamEvents(events, now, 60);
    expect(r.map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
  });

  it('lista vacía si nowIso inválido', () => {
    expect(listUpcomingTeamEvents(events, 'invalid')).toEqual([]);
  });
});

describe('listVisibleAnnouncements', () => {
  const anns = [
    { id: 'a1', title: 'Pinned team', body: 'b', pinned: true, team_id: 't1', created_at: '2026-05-29T10:00:00.000Z' },
    { id: 'a2', title: 'Club-wide', body: 'b', pinned: false, team_id: null, created_at: '2026-05-30T10:00:00.000Z' },
    { id: 'a3', title: 'Otro team', body: 'b', pinned: false, team_id: 't2', created_at: '2026-05-31T10:00:00.000Z' },
    { id: 'a4', title: 'Team mío reciente', body: 'b', pinned: false, team_id: 't1', created_at: '2026-05-31T11:00:00.000Z' },
  ];

  it('incluye club-wide + teams del jugador, excluye otros', () => {
    const r = listVisibleAnnouncements(anns, ['t1']);
    expect(r.map((a) => a.id)).toContain('a1');
    expect(r.map((a) => a.id)).toContain('a2');
    expect(r.map((a) => a.id)).toContain('a4');
    expect(r.map((a) => a.id)).not.toContain('a3');
  });

  it('pinned primero, luego created_at desc', () => {
    const r = listVisibleAnnouncements(anns, ['t1']);
    expect(r[0]?.id).toBe('a1'); // pinned
    expect(r[1]?.id).toBe('a4'); // más reciente
    expect(r[2]?.id).toBe('a2');
  });

  it('dedupe por id', () => {
    const dup = [...anns, anns[0]!];
    const r = listVisibleAnnouncements(dup, ['t1']);
    const ids = r.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respeta limit', () => {
    const r = listVisibleAnnouncements(anns, ['t1'], 2);
    expect(r).toHaveLength(2);
  });

  it('multi-team: incluye ambos', () => {
    const r = listVisibleAnnouncements(anns, ['t1', 't2']);
    expect(r.map((a) => a.id)).toContain('a3');
  });
});
