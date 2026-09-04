import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { getNextEventPerPlayerFromClient, getUpcomingEventsFromClient } from '../index';

/**
 * El próximo evento de CADA hijo en el inicio de familia.
 *
 * De dónde sale: a un padre con dos hijos en el ALEVÍN le salía un amistoso del
 * INFANTIL B. El loader pedía los eventos sin filtrar por equipo y se quedaba con
 * el primero; la RLS abre los partidos a TODO el club a propósito (F7B-2), así que
 * el filtro TIENE que estar aquí. Reproducido contra producción antes de tocar nada.
 *
 * Este mock ignora los filtros (.in/.eq/...) y devuelve lo prefijado por tabla: lo
 * que se prueba es el REPARTO por hijo y la intersección con la temporada activa,
 * que es TypeScript. Los filtros son SQL/RLS y se prueban en pgTAP.
 * Además REGISTRA qué se consulta, para poder afirmar que algo NO se consulta.
 */
function mockClient(config: {
  scope?: string[];
  members?: { player_id: string; team_id: string }[];
  events?: unknown[];
}) {
  const calls: string[] = [];
  const tables: Record<string, unknown[]> = {
    team_members: config.members ?? [],
    events: config.events ?? [],
  };
  function builder(table: string) {
    calls.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'is', 'or', 'gte', 'lte', 'order', 'limit', 'eq']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [] }).then(onF);
    return chain;
  }
  const client = {
    from: (t: string) => builder(t),
    rpc: async (name: string) => {
      calls.push(`rpc:${name}`);
      return { data: config.scope ?? [] };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const CLUB = 'club-1';
const PACO = 'player-paco';
const GABRIEL = 'player-gabriel';
const ALEVIN = 'team-alevin';
const INFANTIL = 'team-infantil';
const ALEVIN_TEMPORADA_VIEJA = 'team-alevin-2025';

const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-09-08T00:00:00.000Z';

function ev(id: string, teamId: string, startsAt: string, type = 'training') {
  return { id, title: id, type, starts_at: startsAt, team_id: teamId, teams: { name: teamId } };
}

describe('getNextEventPerPlayerFromClient', () => {
  it('cada hijo recibe el próximo evento DE SU equipo', async () => {
    const { client } = mockClient({
      scope: [ALEVIN, INFANTIL],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: INFANTIL },
      ],
      events: [
        ev('infantil-martes', INFANTIL, '2026-09-02T16:00:00.000Z'),
        ev('alevin-miercoles', ALEVIN, '2026-09-03T16:00:00.000Z'),
      ],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO, GABRIEL], FROM, TO);

    expect(res.map((r) => [r.playerId, r.event?.id])).toEqual([
      [PACO, 'alevin-miercoles'],
      [GABRIEL, 'infantil-martes'],
    ]);
  });

  it('el fallo original: el evento de OTRO equipo no se le cuela a nadie', async () => {
    const { client } = mockClient({
      scope: [ALEVIN],
      members: [{ player_id: PACO, team_id: ALEVIN }],
      // Lo que devolvía la consulta club-wide: un amistoso del Infantil, antes.
      events: [
        ev('amistoso-infantil', INFANTIL, '2026-09-02T16:00:00.000Z', 'match'),
        ev('entreno-alevin', ALEVIN, '2026-09-04T16:00:00.000Z'),
      ],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO], FROM, TO);

    expect(res).toEqual([
      { playerId: PACO, event: expect.objectContaining({ id: 'entreno-alevin' }) },
    ]);
  });

  it('dos hermanos del MISMO equipo comparten el mismo evento', async () => {
    const { client } = mockClient({
      scope: [ALEVIN],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: ALEVIN },
      ],
      events: [ev('entreno-alevin', ALEVIN, '2026-09-02T16:00:00.000Z')],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO, GABRIEL], FROM, TO);

    expect(res.map((r) => r.event?.id)).toEqual(['entreno-alevin', 'entreno-alevin']);
  });

  it('un hijo sin eventos SIGUE en la lista, con event null', async () => {
    const { client } = mockClient({
      scope: [ALEVIN, INFANTIL],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: INFANTIL },
      ],
      events: [ev('solo-infantil', INFANTIL, '2026-09-02T16:00:00.000Z')],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO, GABRIEL], FROM, TO);

    expect(res).toEqual([
      { playerId: PACO, event: null },
      { playerId: GABRIEL, event: expect.objectContaining({ id: 'solo-infantil' }) },
    ]);
  });

  it('ignora los equipos de temporadas pasadas (los que la RPC no devuelve)', async () => {
    const { client } = mockClient({
      // La RPC solo trae el equipo de la temporada ACTIVA.
      scope: [ALEVIN],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: PACO, team_id: ALEVIN_TEMPORADA_VIEJA },
      ],
      events: [
        ev('evento-del-ano-pasado', ALEVIN_TEMPORADA_VIEJA, '2026-09-02T16:00:00.000Z'),
        ev('evento-de-ahora', ALEVIN, '2026-09-05T16:00:00.000Z'),
      ],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO], FROM, TO);

    expect(res[0]?.event?.id).toBe('evento-de-ahora');
  });

  it('un equipo con MUCHOS eventos no deja al otro hijo sin el suyo', async () => {
    const muchos = Array.from({ length: 30 }, (_, i) =>
      ev(`infantil-${i}`, INFANTIL, `2026-09-02T${String(8 + (i % 12)).padStart(2, '0')}:00:00.000Z`)
    );
    const { client } = mockClient({
      scope: [ALEVIN, INFANTIL],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: INFANTIL },
      ],
      events: [...muchos, ev('alevin-tarde', ALEVIN, '2026-09-07T16:00:00.000Z')],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO, GABRIEL], FROM, TO);

    expect(res[0]?.event?.id).toBe('alevin-tarde');
    expect(res[1]?.event?.id).toBe('infantil-0');
  });

  it('respeta el orden en que llegan los hijos', async () => {
    const { client } = mockClient({
      scope: [ALEVIN, INFANTIL],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: INFANTIL },
      ],
      events: [],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [GABRIEL, PACO], FROM, TO);

    expect(res.map((r) => r.playerId)).toEqual([GABRIEL, PACO]);
  });

  it('sin hijos: lista vacía y NO consulta nada', async () => {
    const { client, calls } = mockClient({});
    expect(await getNextEventPerPlayerFromClient(client, CLUB, [], FROM, TO)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('ningún hijo con equipo en la temporada activa: NO consulta eventos', async () => {
    const { client, calls } = mockClient({
      scope: [],
      members: [{ player_id: PACO, team_id: ALEVIN }],
      events: [ev('no-deberia-verse', INFANTIL, '2026-09-02T16:00:00.000Z')],
    });

    const res = await getNextEventPerPlayerFromClient(client, CLUB, [PACO], FROM, TO);

    expect(res).toEqual([{ playerId: PACO, event: null }]);
    expect(calls).not.toContain('events');
  });

  it('las dos primeras consultas van en paralelo y son UNA por lote, no una por hijo', async () => {
    const { client, calls } = mockClient({
      scope: [ALEVIN],
      members: [
        { player_id: PACO, team_id: ALEVIN },
        { player_id: GABRIEL, team_id: ALEVIN },
      ],
      events: [ev('entreno', ALEVIN, '2026-09-02T16:00:00.000Z')],
    });

    await getNextEventPerPlayerFromClient(client, CLUB, [PACO, GABRIEL], FROM, TO);

    expect(calls).toEqual(['rpc:user_team_ids_in_club', 'team_members', 'events']);
  });
});

describe('getUpcomingEventsFromClient — lista vacía ≠ sin filtro', () => {
  it('teamIds=[] devuelve [] SIN consultar (no cae a club-wide)', async () => {
    const { client, calls } = mockClient({
      events: [ev('de-otro-equipo', INFANTIL, '2026-09-02T16:00:00.000Z')],
    });

    expect(await getUpcomingEventsFromClient(client, FROM, TO, 5, undefined, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('sin teamIds sigue consultando (comportamiento de siempre)', async () => {
    const { client, calls } = mockClient({
      events: [ev('lo-que-deje-la-rls', INFANTIL, '2026-09-02T16:00:00.000Z')],
    });

    const res = await getUpcomingEventsFromClient(client, FROM, TO);

    expect(res.map((e) => e.id)).toEqual(['lo-que-deje-la-rls']);
    expect(calls).toEqual(['events']);
  });
});
