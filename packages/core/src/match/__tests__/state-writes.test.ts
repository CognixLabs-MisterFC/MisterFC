import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  prepareMatchSheetFromClient,
  startMatchFromClient,
  pauseClockFromClient,
  resumeClockFromClient,
  endPeriodFromClient,
  startNextPeriodFromClient,
  adjustClockFromClient,
  finishMatchFromClient,
  reopenMatchFromClient,
  userCanRecordMatchFromClient,
} from '../state-writes';
import type { Database } from '../../supabase/types';

const EVENT = 'aaaaaaaa-0000-4000-8000-000000000001';

type Write = { table: string; op: 'insert' | 'update' | 'delete'; payload?: unknown };

type Period = {
  id: string;
  period: string;
  ordinal: number;
  base_offset_seconds: number;
  accumulated_seconds: number;
  running: boolean;
  last_started_at: string | null;
  ended: boolean;
};

type Opts = {
  event?: unknown; // events maybeSingle (null → not_found)
  matchState?: unknown; // match_state maybeSingle (null → status null)
  periods?: Period[]; // match_periods list
  starters?: Array<{ player_id: string }>; // match_starters list
  official?: { id: string } | null; // lineups maybeSingle
  positions?: Array<{ player_id: string; position_code: string | null }>;
  events?: unknown[]; // match_events list
  absences?: Array<{ player_id: string }>;
  canRecord?: boolean;
  /**
   * `categories.period_count` del equipo del evento, que es de donde sale
   * cuántos periodos regulares tiene el partido. Por defecto 2: el join viaja
   * en la MISMA lectura de `events` que ya hacían estas pruebas.
   */
  periodCount?: number;
  /** `categories.half_duration_minutes` del equipo del evento. */
  halfMinutes?: number;
  failOn?: { table: string; op: 'insert' | 'update' | 'delete'; code?: string };
};

function makeClient(opts: Opts, userId: string | null = 'u-1') {
  const writes: Write[] = [];

  const singleFor = (table: string): unknown => {
    switch (table) {
      case 'events':
        return opts.event === undefined
          ? {
              id: EVENT,
              club_id: 'club-1',
              team_id: 't-1',
              type: 'match',
              // `loadPeriodCount` lee esto con un select anidado
              // (teams!inner.categories!inner.period_count).
              teams: {
                categories: {
                  period_count: opts.periodCount ?? 2,
                  // `prepareMatchSheet` lee la DURACIÓN en la misma consulta que el
                  // número de periodos: las dos columnas del reloj viajan juntas.
                  half_duration_minutes: opts.halfMinutes ?? 45,
                },
              },
            }
          : opts.event;
      case 'match_state':
        return opts.matchState ?? null;
      case 'lineups':
        return opts.official ?? null;
      default:
        return null;
    }
  };
  const listFor = (table: string): unknown[] => {
    switch (table) {
      case 'match_periods':
        return opts.periods ?? [];
      case 'match_starters':
        return opts.starters ?? [];
      case 'lineup_positions':
        return opts.positions ?? [];
      case 'match_events':
        return opts.events ?? [];
      case 'match_absences':
        return opts.absences ?? [];
      default:
        return [];
    }
  };

  const from = (table: string) => {
    const maybeErr = (op: 'insert' | 'update' | 'delete') =>
      opts.failOn && opts.failOn.table === table && opts.failOn.op === op
        ? { error: { message: 'x', code: opts.failOn.code } }
        : { error: null };

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.maybeSingle = async () => ({ data: singleFor(table) });
    b.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: listFor(table) });
    b.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload });
      return Promise.resolve(maybeErr('insert'));
    };
    b.update = (payload: unknown) => {
      writes.push({ table, op: 'update', payload });
      const u: Record<string, unknown> = {};
      u.eq = () => u;
      u.then = (resolve: (v: unknown) => unknown) => resolve(maybeErr('update'));
      return u;
    };
    b.delete = () => {
      const d: Record<string, unknown> = {};
      d.eq = () => d;
      d.then = (resolve: (v: unknown) => unknown) => {
        writes.push({ table, op: 'delete' });
        return resolve(maybeErr('delete'));
      };
      return d;
    };
    return b;
  };

  const client = {
    from,
    rpc: async () => ({ data: opts.canRecord ?? false }),
    auth: {
      getUser: async () => ({ data: { user: userId === null ? null : { id: userId } } }),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, writes };
}

const ref = { event_id: EVENT };
const runningPeriod: Period = {
  id: 'p1',
  period: 'first_half',
  ordinal: 1,
  base_offset_seconds: 0,
  accumulated_seconds: 0,
  running: true,
  last_started_at: '2026-01-01T00:00:00Z',
  ended: false,
};

describe('O2-9a · startMatchFromClient', () => {
  it('sin usuario → forbidden', async () => {
    const { client } = makeClient({}, null);
    expect(await startMatchFromClient(client, ref)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('evento inexistente → not_found', async () => {
    const { client } = makeClient({ event: null });
    expect(await startMatchFromClient(client, ref)).toEqual({ ok: false, error: 'not_found' });
  });

  it('ya cerrado → already_closed', async () => {
    const { client } = makeClient({ matchState: { status: 'closed' } });
    expect(await startMatchFromClient(client, ref)).toEqual({ ok: false, error: 'already_closed' });
  });

  it('sin alineación oficial → no_official_lineup Y NO SE ESCRIBE NADA', async () => {
    // EL DIENTE DE ESTE TEST ES LA SEGUNDA MITAD. Afirmar solo el valor devuelto
    // dejaba pasar el bug real: la comprobación de la alineación estaba DESPUÉS de
    // poner `match_state` en `live`, y esto no es una transacción. El partido se
    // quedaba live —saliendo en la lista de directos de las familias, que mira
    // `status === 'live'`— sin once y sin periodos, y la llamada devolvía este
    // mismo error. El test estaba verde porque el retorno era el correcto.
    const { client, writes } = makeClient({ matchState: null, starters: [], official: null });
    expect(await startMatchFromClient(client, ref)).toEqual({
      ok: false,
      error: 'no_official_lineup',
    });
    expect(writes, 'una negativa no puede dejar escrituras detrás').toEqual([]);
  });

  it('el once YA congelado no exige alineación: re-arrancar sigue funcionando', async () => {
    // La otra orilla de la puerta. Si se exigiera la alineación también con el once
    // ya congelado, borrarla después dejaría el partido sin poder reanudarse — y de
    // esta rama depende la idempotencia de la función.
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      starters: [{ player_id: 'pl-1' }],
      official: null,
      periods: [],
    });
    expect(await startMatchFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_starters')).toBeUndefined();
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'insert')).toBeTruthy();
  });

  it('arranque limpio: inserta match_state live, once y 1ª parte', async () => {
    const { client, writes } = makeClient({
      matchState: null,
      starters: [],
      official: { id: 'l-1' },
      positions: [{ player_id: 'pl-1', position_code: 'GK' }],
      periods: [],
    });
    const r = await startMatchFromClient(client, ref);
    expect(r).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_state' && w.op === 'insert')).toBeTruthy();
    expect(writes.find((w) => w.table === 'match_starters' && w.op === 'insert')).toBeTruthy();
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'insert')).toBeTruthy();
  });

  it('rechazo RLS (42501) al crear match_state → forbidden', async () => {
    // El fixture LLEVA alineación oficial a propósito: la comprobación de la
    // alineación va antes del write, así que sin ella este test no llegaría nunca
    // al insert donde está montado el 42501 y mediría otra cosa. Cuando la puerta
    // estaba después, este fixture pasaba sin alineación — o sea que el propio
    // fixture codificaba el orden equivocado.
    const { client } = makeClient({
      matchState: null,
      starters: [],
      official: { id: 'l-1' },
      positions: [{ player_id: 'pl-1', position_code: 'GK' }],
      failOn: { table: 'match_state', op: 'insert', code: '42501' },
    });
    expect(await startMatchFromClient(client, ref)).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('O2-9a · pause/resume/end/adjust', () => {
  it('pauseClock sin partido live → not_live', async () => {
    const { client } = makeClient({ matchState: { status: 'not_started' } });
    expect(await pauseClockFromClient(client, ref)).toEqual({ ok: false, error: 'not_live' });
  });

  it('pauseClock con periodo corriendo → update match_periods', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [runningPeriod],
    });
    expect(await pauseClockFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'update')).toBeTruthy();
  });

  it('pauseClock sin periodo corriendo → ok idempotente sin escribir', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [{ ...runningPeriod, running: false, last_started_at: null }],
    });
    expect(await pauseClockFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.length).toBe(0);
  });

  it('resumeClock de un periodo terminado → period_ended', async () => {
    const { client } = makeClient({
      matchState: { status: 'live' },
      periods: [{ ...runningPeriod, running: false, last_started_at: null, ended: true }],
    });
    expect(await resumeClockFromClient(client, ref)).toEqual({ ok: false, error: 'period_ended' });
  });

  it('endPeriod actualiza el periodo en curso', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [runningPeriod],
    });
    expect(await endPeriodFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'update')).toBeTruthy();
  });

  it('adjustClock ±segundos actualiza el periodo actual', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [runningPeriod],
    });
    const r = await adjustClockFromClient(client, { event_id: EVENT, delta_seconds: -30 });
    expect(r).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'update')).toBeTruthy();
  });
});

describe('O2-9a · startNextPeriod', () => {
  const endedFirst: Period = {
    ...runningPeriod,
    running: false,
    last_started_at: null,
    accumulated_seconds: 2700,
    ended: true,
  };

  it('periodo pedido que no toca → period_mismatch', async () => {
    const { client } = makeClient({ matchState: { status: 'live' }, periods: [endedFirst] });
    const r = await startNextPeriodFromClient(client, { event_id: EVENT, period: 'penalties' });
    expect(r).toEqual({ ok: false, error: 'period_mismatch' });
  });

  it('empezar 2ª parte inserta match_periods', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst],
    });
    const r = await startNextPeriodFromClient(client, { event_id: EVENT, period: 'second_half' });
    expect(r).toEqual({ ok: true });
    expect(writes.find((w) => w.table === 'match_periods' && w.op === 'insert')).toBeTruthy();
  });
});

describe('O2-9a · finishMatch', () => {
  const endedFirst: Period = {
    ...runningPeriod,
    running: false,
    last_started_at: null,
    accumulated_seconds: 2700,
    ended: true,
  };
  const endedSecond: Period = {
    id: 'p2',
    period: 'second_half',
    ordinal: 2,
    base_offset_seconds: 2700,
    accumulated_seconds: 2700,
    running: false,
    last_started_at: null,
    ended: true,
  };

  it('con una parte regular pendiente → regulation_incomplete', async () => {
    const { client } = makeClient({ matchState: { status: 'live' }, periods: [endedFirst] });
    expect(await finishMatchFromClient(client, ref)).toEqual({
      ok: false,
      error: 'regulation_incomplete',
    });
  });

  it('ya cerrado → ok idempotente', async () => {
    const { client, writes } = makeClient({ matchState: { status: 'closed' } });
    expect(await finishMatchFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.length).toBe(0);
  });

  it('finaliza: cierra el estado y consolida (match_player_stats + marcador)', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      starters: [{ player_id: 'pl-1' }],
      events: [
        {
          side: 'own',
          type: 'goal',
          player_id: 'pl-1',
          related_player_id: null,
          clock_seconds: 600,
          metadata: {},
        },
      ],
    });
    const r = await finishMatchFromClient(client, ref);
    expect(r).toEqual({ ok: true });
    // status → closed
    expect(
      writes.find(
        (w) =>
          w.table === 'match_state' &&
          w.op === 'update' &&
          (w.payload as { status?: string }).status === 'closed',
      ),
    ).toBeTruthy();
    // consolidación: delete+insert de match_player_stats + update del marcador
    expect(writes.find((w) => w.table === 'match_player_stats' && w.op === 'delete')).toBeTruthy();
    expect(writes.find((w) => w.table === 'match_player_stats' && w.op === 'insert')).toBeTruthy();
    expect(
      writes.find(
        (w) =>
          w.table === 'match_state' &&
          w.op === 'update' &&
          (w.payload as { goals_for?: number }).goals_for === 1,
      ),
    ).toBeTruthy();
  });
});

describe('O2-9a · reopenMatch + gate', () => {
  it('reabrir un partido cerrado → live +reopened_count', async () => {
    const { client, writes } = makeClient({ matchState: { status: 'closed', reopened_count: 0 } });
    expect(await reopenMatchFromClient(client, ref)).toEqual({ ok: true });
    const upd = writes.find((w) => w.table === 'match_state' && w.op === 'update');
    expect(upd!.payload as { status?: string; reopened_count?: number }).toMatchObject({
      status: 'live',
      reopened_count: 1,
    });
  });

  it('reabrir uno no cerrado → ok idempotente sin escribir', async () => {
    const { client, writes } = makeClient({ matchState: { status: 'live', reopened_count: 0 } });
    expect(await reopenMatchFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.length).toBe(0);
  });

  it('userCanRecordMatchFromClient refleja el rpc', async () => {
    const { client } = makeClient({ canRecord: true });
    expect(await userCanRecordMatchFromClient(client, EVENT)).toBe(true);
    const { client: c2 } = makeClient({ canRecord: false });
    expect(await userCanRecordMatchFromClient(c2, EVENT)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL CAMINO DE ESCRITURA CON TRES PERIODOS. Los tests de `clock.ts` miden el
// motor; estos miden que el número de periodos LLEGA desde la categoría hasta
// los botones. Si `loadPeriodCount` dejara de leerse, el motor seguiría siendo
// correcto y el botón seguiría equivocándose.
// ─────────────────────────────────────────────────────────────────────────────
describe('tres tiempos · las escrituras leen period_count de la categoría', () => {
  const endedFirst: Period = {
    ...runningPeriod,
    running: false,
    last_started_at: null,
    accumulated_seconds: 720, // 12:00
    ended: true,
  };
  const endedSecond: Period = {
    id: 'p2',
    period: 'second_half',
    ordinal: 2,
    base_offset_seconds: 720,
    accumulated_seconds: 720,
    running: false,
    last_started_at: null,
    ended: true,
  };

  it('EL FRENO: finalizar con el tercer tiempo sin jugar → regulation_incomplete', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      periodCount: 3,
    });
    expect(await finishMatchFromClient(client, ref)).toEqual({
      ok: false,
      error: 'regulation_incomplete',
    });
    // Y no ha consolidado nada: el marcador de un partido a medias no se cierra.
    expect(writes.length).toBe(0);
  });

  it('el MISMO partido en una categoría de dos sí finaliza (la diferencia es la categoría)', async () => {
    const { client } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      periodCount: 2,
      starters: [],
      events: [],
    });
    expect(await finishMatchFromClient(client, ref)).toEqual({ ok: true });
  });

  it('con los tres jugados sí finaliza', async () => {
    const tercero: Period = {
      id: 'p3',
      period: 'third_period',
      ordinal: 3,
      base_offset_seconds: 1440,
      accumulated_seconds: 720,
      running: false,
      last_started_at: null,
      ended: true,
    };
    const { client } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond, tercero],
      periodCount: 3,
      starters: [],
      events: [],
    });
    expect(await finishMatchFromClient(client, ref)).toEqual({ ok: true });
  });

  it('startNextPeriod: tras la 2ª, el que toca es el tercer tiempo con ordinal 3', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      periodCount: 3,
    });
    const r = await startNextPeriodFromClient(client, {
      event_id: EVENT,
      period: 'third_period',
    });
    expect(r).toEqual({ ok: true });
    const ins = writes.find((w) => w.table === 'match_periods' && w.op === 'insert');
    expect(ins!.payload).toMatchObject({
      period: 'third_period',
      ordinal: 3,
      base_offset_seconds: 1440, // 12+12, el reloj acumulado
      running: true,
    });
  });

  it('startNextPeriod: pedir prórroga saltándose el tercer tiempo → period_mismatch', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      periodCount: 3,
    });
    const r = await startNextPeriodFromClient(client, {
      event_id: EVENT,
      period: 'extra_first',
    });
    expect(r).toEqual({ ok: false, error: 'period_mismatch' });
    expect(writes.length).toBe(0);
  });

  it('y en una categoría de dos, pedir el tercer tiempo → period_mismatch', async () => {
    const { client } = makeClient({
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      periodCount: 2,
    });
    const r = await startNextPeriodFromClient(client, {
      event_id: EVENT,
      period: 'third_period',
    });
    expect(r).toEqual({ ok: false, error: 'period_mismatch' });
  });

  it('una categoría sin period_count (join vacío) cuenta DOS, no revienta', async () => {
    // `event` a mano, SIN la categoría anidada: es lo que llega si el equipo o
    // la categoría no están. El partido se comporta como el de siempre.
    const { client } = makeClient({
      event: { id: EVENT, club_id: 'club-1', team_id: 't-1', type: 'match' },
      matchState: { status: 'live' },
      periods: [endedFirst, endedSecond],
      starters: [],
      events: [],
    });
    expect(await finishMatchFromClient(client, ref)).toEqual({ ok: true });
  });
});

describe('prepareMatchSheetFromClient · reconstruir el acta de un partido ya jugado', () => {
  const official = { id: 'lineup-1' };
  const positions = [
    { player_id: 'p-1', position_code: 'GK' },
    { player_id: 'p-2', position_code: 'DF' },
  ];

  it('sin usuario → forbidden', async () => {
    const { client } = makeClient({}, null);
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  // LA PUERTA, Y VA ANTES DE ESCRIBIR. Esto no es una transacción: si el gate se
  // comprobara después, quedaría un partido a medio reconstruir y nada lo desharía.
  it('sin alineación oficial → no_official_lineup, y NO escribe NADA', async () => {
    const { client, writes } = makeClient({ matchState: null, official: null });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({
      ok: false,
      error: 'no_official_lineup',
    });
    expect(writes).toHaveLength(0);
  });

  it('una alineación oficial VACÍA tampoco vale (no se inventa un once)', async () => {
    const { client, writes } = makeClient({ matchState: null, official, positions: [] });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({
      ok: false,
      error: 'no_official_lineup',
    });
    expect(writes).toHaveLength(0);
  });

  it('congela el once, siembra los periodos y cierra el acta', async () => {
    const { client, writes } = makeClient({ matchState: null, official, positions });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });

    const starters = writes.find((w) => w.table === 'match_starters');
    expect(starters?.op).toBe('insert');
    expect((starters?.payload as unknown[]).length).toBe(2);

    const periodos = writes.find((w) => w.table === 'match_periods');
    expect((periodos?.payload as { period: string }[]).map((p) => p.period)).toEqual([
      'first_half',
      'second_half',
    ]);

    const estado = writes.find((w) => w.table === 'match_state');
    expect((estado?.payload as { status: string }).status).toBe('closed');
  });

  // Lo que ata esta pieza al arreglo de los periodos: en querubín son TRES, y la
  // duración sale de la categoría, no de un 45 por defecto.
  it('en una categoría de TRES tiempos siembra tres, con su duración', async () => {
    const { client, writes } = makeClient({
      matchState: null,
      official,
      positions,
      periodCount: 3,
      halfMinutes: 12,
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });

    const periodos = writes.find((w) => w.table === 'match_periods')?.payload as {
      period: string;
      base_offset_seconds: number;
      accumulated_seconds: number;
    }[];
    expect(periodos.map((p) => p.period)).toEqual(['first_half', 'second_half', 'third_period']);
    expect(periodos.map((p) => p.base_offset_seconds)).toEqual([0, 720, 1440]);
    expect(periodos.every((p) => p.accumulated_seconds === 720)).toBe(true);
  });

  it('idempotente: un partido ya CERRADO no se toca', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'closed' },
      official,
      positions,
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });
    expect(writes).toHaveLength(0);
  });

  it('idempotente: un partido EN VIVO tampoco', async () => {
    const { client, writes } = makeClient({ matchState: { status: 'live' }, official, positions });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });
    expect(writes).toHaveLength(0);
  });

  it('con el once YA congelado no vuelve a congelarlo', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'not_started' },
      starters: [{ player_id: 'p-1' }],
      official: null, // y sin alineación oficial: ya no hace falta
      positions: [],
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.some((w) => w.table === 'match_starters')).toBe(false);
    expect(writes.some((w) => w.table === 'match_periods')).toBe(true);
  });

  it('con los periodos YA sembrados no los duplica', async () => {
    const { client, writes } = makeClient({
      matchState: { status: 'not_started' },
      official,
      positions,
      periods: [runningPeriod],
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.some((w) => w.table === 'match_periods')).toBe(false);
  });

  it('un evento que no es partido → invalid', async () => {
    const { client, writes } = makeClient({
      event: { id: EVENT, club_id: 'club-1', team_id: 't-1', type: 'training' },
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(writes).toHaveLength(0);
  });

  it('un partido sin equipo → invalid', async () => {
    const { client } = makeClient({
      event: { id: EVENT, club_id: 'club-1', team_id: null, type: 'match' },
    });
    expect(await prepareMatchSheetFromClient(client, ref)).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
