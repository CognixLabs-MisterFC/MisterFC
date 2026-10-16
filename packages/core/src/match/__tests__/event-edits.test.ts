import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  actorPatchFor,
  eventEditAvailability,
  deleteMatchEventFromClient,
  updateMatchEventActorFromClient,
  updateMatchEventMinuteFromClient,
} from '../event-edits';
import type { Database } from '../../supabase/types';

/**
 * Corregir un evento del directo (borrar · minuto · actor).
 *
 * El mock REGISTRA LOS FILTROS, no solo el payload. Sin eso, una escritura que se
 * dejara el `.eq('id', …)` tocaría TODOS los eventos del partido y el test seguiría
 * verde: el payload sería idéntico. Es la diferencia entre medir «qué escribe» y
 * medir «a qué fila».
 */

const EVENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ROW = 'bbbbbbbb-0000-4000-8000-000000000002';
const PLAYER = 'cccccccc-0000-4000-8000-000000000003';
const PLAYER_2 = 'cccccccc-0000-4000-8000-000000000004';

type Write = {
  table: string;
  op: 'insert' | 'update' | 'delete';
  payload?: unknown;
  filtros: Array<[string, unknown]>;
};

type Period = {
  period: string;
  ordinal: number;
  base_offset_seconds: number;
  accumulated_seconds: number;
  running: boolean;
  last_started_at: string | null;
  ended: boolean;
};

const PERIODO: Period = {
  period: 'first_half',
  ordinal: 1,
  base_offset_seconds: 0,
  accumulated_seconds: 1800,
  running: false,
  last_started_at: null,
  ended: true,
};

type Opts = {
  /** `match_state.status`. undefined → 'live'. null → no hay fila. */
  status?: 'not_started' | 'live' | 'closed' | null;
  /** La fila de match_events que lee el cambio de actor. null → no existe/no visible. */
  row?: { side: 'own' | 'rival'; type: string } | null;
  periods?: Period[];
  failOn?: { op: 'insert' | 'update' | 'delete'; code?: string; message?: string };
};

function makeClient(opts: Opts, userId: string | null = 'u-1') {
  const writes: Write[] = [];
  let statusLeido = 0;

  const from = (table: string) => {
    const filtros: Array<[string, unknown]> = [];
    const maybeErr = (op: 'insert' | 'update' | 'delete') =>
      opts.failOn && opts.failOn.op === op
        ? {
            error: {
              message: opts.failOn.message ?? 'x',
              code: opts.failOn.code,
            },
          }
        : { error: null };

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filtros.push([col, val]);
      return b;
    };
    b.order = () => b;
    b.limit = () => b;
    b.maybeSingle = async () => {
      if (table === 'match_state') {
        statusLeido += 1;
        return { data: opts.status === null ? null : { status: opts.status ?? 'live' } };
      }
      if (table === 'match_events') {
        return { data: opts.row === undefined ? { side: 'own', type: 'goal' } : opts.row };
      }
      // `events` solo lo lee la RE-CONSOLIDACIÓN (partido cerrado). Devolverlo aquí
      // es lo que permite que esa rama avance hasta escribir, y por tanto medirla.
      if (table === 'events') {
        return { data: { club_id: 'club-1', team_id: 't-1' } };
      }
      return { data: null };
    };
    b.then = (resolve: (v: { data: unknown[] }) => unknown) =>
      resolve({ data: table === 'match_periods' ? (opts.periods ?? [PERIODO]) : [] });
    b.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload, filtros: [] });
      return Promise.resolve({ error: null });
    };
    b.update = (payload: unknown) => {
      const u: Record<string, unknown> = {};
      const propios: Array<[string, unknown]> = [];
      u.eq = (col: string, val: unknown) => {
        propios.push([col, val]);
        return u;
      };
      u.then = (resolve: (v: unknown) => unknown) => {
        writes.push({ table, op: 'update', payload, filtros: propios });
        return resolve(maybeErr('update'));
      };
      return u;
    };
    b.delete = () => {
      const d: Record<string, unknown> = {};
      const propios: Array<[string, unknown]> = [];
      d.eq = (col: string, val: unknown) => {
        propios.push([col, val]);
        return d;
      };
      d.then = (resolve: (v: unknown) => unknown) => {
        writes.push({ table, op: 'delete', filtros: propios });
        return resolve(maybeErr('delete'));
      };
      return d;
    };
    return b;
  };

  const client = {
    from,
    rpc: async () => ({ data: true }),
    auth: {
      getUser: async () => ({ data: { user: userId === null ? null : { id: userId } } }),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, writes, vecesQueLeyoElEstado: () => statusLeido };
}

const ref = { event_id: EVENT, id: ROW };

// ─────────────────────────────────────────────────────────────────────────────
describe('actorPatchFor · qué se puede cambiar en ESTA fila', () => {
  it('evento propio: cambia el jugador', () => {
    expect(actorPatchFor({ side: 'own', type: 'goal' }, { player_id: PLAYER })).toEqual({
      player_id: PLAYER,
    });
  });

  // El CHECK `related_only_sub` prohíbe el segundo jugador fuera de una sustitución.
  // Si se colara, la base lo rechazaría con un mensaje que no dice nada al entrenador.
  it('el segundo jugador NO entra en un gol', () => {
    expect(actorPatchFor({ side: 'own', type: 'goal' }, { related_player_id: PLAYER_2 })).toEqual(
      {},
    );
  });

  it('el segundo jugador SÍ entra en una sustitución', () => {
    expect(
      actorPatchFor(
        { side: 'own', type: 'substitution' },
        { player_id: PLAYER, related_player_id: PLAYER_2 },
      ),
    ).toEqual({ player_id: PLAYER, related_player_id: PLAYER_2 });
  });

  // El CHECK `actor_by_side`: un evento del rival no tiene jugador NUESTRO.
  it('evento del rival: solo el dorsal, y el jugador se descarta', () => {
    expect(
      actorPatchFor({ side: 'rival', type: 'goal' }, { player_id: PLAYER, rival_dorsal: 9 }),
    ).toEqual({ rival_dorsal: 9 });
  });

  it('dorsal 0 es un dorsal (no se cae por falsy)', () => {
    expect(actorPatchFor({ side: 'rival', type: 'goal' }, { rival_dorsal: 0 })).toEqual({
      rival_dorsal: 0,
    });
  });

  it('un dorsal en un evento PROPIO no se aplica', () => {
    expect(actorPatchFor({ side: 'own', type: 'goal' }, { rival_dorsal: 9 })).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteMatchEventFromClient', () => {
  it('borra la fila del partido Y del id: nunca el partido entero', async () => {
    const { client, writes } = makeClient({});
    expect(await deleteMatchEventFromClient(client, ref)).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.table).toBe('match_events');
    expect(writes[0]!.op).toBe('delete');
    // Los DOS filtros. Si faltara el del id, este delete se llevaría el acta entera.
    expect(writes[0]!.filtros).toEqual([
      ['event_id', EVENT],
      ['id', ROW],
    ]);
  });

  it('partido sin empezar → not_editable, y NO escribe', async () => {
    const { client, writes } = makeClient({ status: 'not_started' });
    expect(await deleteMatchEventFromClient(client, ref)).toEqual({
      ok: false,
      error: 'not_editable',
    });
    expect(writes).toHaveLength(0);
  });

  it('partido sin fila de estado → not_editable', async () => {
    const { client } = makeClient({ status: null });
    expect(await deleteMatchEventFromClient(client, ref)).toEqual({
      ok: false,
      error: 'not_editable',
    });
  });

  it('partido CERRADO sí se edita (corregir el acta después)', async () => {
    const { client, writes } = makeClient({ status: 'closed' });
    expect(await deleteMatchEventFromClient(client, ref)).toEqual({ ok: true });
    expect(writes.some((w) => w.table === 'match_events' && w.op === 'delete')).toBe(true);
  });

  // LO QUE HACE QUE EL ACTA CUADRE. Con el partido cerrado, las stats y el marcador
  // ya están materializados: una corrección tiene que RE-materializarlos. Esto vivía
  // solo en la web, así que corregir desde el móvil habría dejado el acta descuadrada
  // sin avisar a nadie. Se mide por la escritura, no por el ok.
  it('partido CERRADO: re-materializa las stats (si no, el acta queda descuadrada)', async () => {
    const { client, writes } = makeClient({ status: 'closed' });
    await deleteMatchEventFromClient(client, ref);
    expect(writes.some((w) => w.table === 'match_player_stats')).toBe(true);
  });

  it('partido EN VIVO: NO re-materializa nada (las stats aún no existen)', async () => {
    const { client, writes } = makeClient({ status: 'live' });
    await deleteMatchEventFromClient(client, ref);
    expect(writes.some((w) => w.table === 'match_player_stats')).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('un 42501 de la RLS es forbidden, no un error genérico', async () => {
    const { client } = makeClient({ failOn: { op: 'delete', code: '42501' } });
    expect(await deleteMatchEventFromClient(client, ref)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('id que no es uuid → invalid, sin tocar la base', async () => {
    const { client, writes } = makeClient({});
    expect(await deleteMatchEventFromClient(client, { event_id: EVENT, id: 'x' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(writes).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateMatchEventMinuteFromClient', () => {
  it('escribe reloj Y periodo derivados del minuto, no el minuto a pelo', async () => {
    const { client, writes } = makeClient({});
    expect(await updateMatchEventMinuteFromClient(client, { ...ref, display_minute: 12 })).toEqual({
      ok: true,
    });
    expect(writes).toHaveLength(1);
    const payload = writes[0]!.payload as {
      clock_seconds: number;
      period: string;
      display_minute: number;
    };
    // El motor ancla el evento al INICIO del minuto: `minute * 60`, y `displayMinute`
    // es su inversa exacta (`displayMinute(12*60) === 12`). Lo importante además del
    // número: las TRES columnas viajan juntas, porque el orden del timeline y el acta
    // se derivan de `clock_seconds`, no del minuto.
    expect(payload.clock_seconds).toBe(720);
    expect(payload.period).toBe('first_half');
    expect(payload.display_minute).toBe(12);
    expect(writes[0]!.filtros).toEqual([
      ['event_id', EVENT],
      ['id', ROW],
    ]);
  });

  it('sin periodos no se puede derivar nada → no_period, y NO escribe', async () => {
    const { client, writes } = makeClient({ periods: [] });
    expect(await updateMatchEventMinuteFromClient(client, { ...ref, display_minute: 12 })).toEqual({
      ok: false,
      error: 'no_period',
    });
    expect(writes).toHaveLength(0);
  });

  it('un minuto fuera de rango lo para el esquema', async () => {
    const { client, writes } = makeClient({});
    expect(await updateMatchEventMinuteFromClient(client, { ...ref, display_minute: 999 })).toEqual(
      { ok: false, error: 'invalid' },
    );
    expect(writes).toHaveLength(0);
  });

  it('el minuto 0 es válido (un gol en el saque inicial)', async () => {
    const { client, writes } = makeClient({});
    expect(await updateMatchEventMinuteFromClient(client, { ...ref, display_minute: 0 })).toEqual({
      ok: true,
    });
    expect(writes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateMatchEventActorFromClient', () => {
  it('lee la fila y aplica solo lo coherente', async () => {
    const { client, writes } = makeClient({ row: { side: 'own', type: 'goal' } });
    expect(await updateMatchEventActorFromClient(client, { ...ref, player_id: PLAYER })).toEqual({
      ok: true,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual({ player_id: PLAYER });
    expect(writes[0]!.filtros).toEqual([
      ['event_id', EVENT],
      ['id', ROW],
    ]);
  });

  // La fila que no se ve y la que no existe llegan igual (null de maybeSingle), y las
  // dos se cuentan igual: el entrenador no puede hacer nada con la diferencia.
  it('fila que no existe o no es visible → not_found, sin escribir', async () => {
    const { client, writes } = makeClient({ row: null });
    expect(await updateMatchEventActorFromClient(client, { ...ref, player_id: PLAYER })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(writes).toHaveLength(0);
  });

  it('pedir un dorsal en un evento propio no escribe nada → invalid', async () => {
    const { client, writes } = makeClient({ row: { side: 'own', type: 'goal' } });
    expect(await updateMatchEventActorFromClient(client, { ...ref, rival_dorsal: 9 })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(writes).toHaveLength(0);
  });

  it('sin ningún actor, lo para el esquema', async () => {
    const { client } = makeClient({});
    expect(await updateMatchEventActorFromClient(client, ref)).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('el rechazo del trigger de pertenencia llega con su nombre', async () => {
    const { client } = makeClient({
      row: { side: 'own', type: 'goal' },
      failOn: { op: 'update', message: 'player_not_in_team_at_event' },
    });
    expect(await updateMatchEventActorFromClient(client, { ...ref, player_id: PLAYER })).toEqual({
      ok: false,
      error: 'player_not_in_team',
    });
  });

  it('las columnas inmutables del trigger son invalid, no genérico', async () => {
    const { client } = makeClient({
      row: { side: 'own', type: 'goal' },
      failOn: { op: 'update', message: 'created_by_immutable' },
    });
    expect(await updateMatchEventActorFromClient(client, { ...ref, player_id: PLAYER })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('eventEditAvailability · qué puede ofrecer la pantalla', () => {
  it('con permiso, red y el partido en vivo: se corrige', () => {
    expect(eventEditAvailability({ canRecord: true, online: true, status: 'live' })).toBe('edit');
  });

  it('un partido CERRADO también se corrige (el acta, después)', () => {
    expect(eventEditAvailability({ canRecord: true, online: true, status: 'closed' })).toBe('edit');
  });

  it('sin red: se ve, pero avisa — no se encola', () => {
    expect(eventEditAvailability({ canRecord: true, online: false, status: 'live' })).toBe(
      'offline',
    );
  });

  it('sin permiso lo DICE, en vez de la misma frase que a quien puede', () => {
    expect(eventEditAvailability({ canRecord: false, online: true, status: 'live' })).toBe(
      'no_permission',
    );
  });

  it('un partido sin empezar no tiene nada que corregir', () => {
    expect(eventEditAvailability({ canRecord: true, online: true, status: 'not_started' })).toBe(
      'not_editable',
    );
  });

  it('sin fila de estado, tampoco', () => {
    expect(eventEditAvailability({ canRecord: true, online: true, status: null })).toBe(
      'not_editable',
    );
  });

  // PRECEDENCIA, que es la regla y no un detalle. Los dos casos que la fijan:
  it('sin permiso gana sobre sin red: el permiso no lo arregla la cobertura', () => {
    expect(eventEditAvailability({ canRecord: false, online: false, status: 'live' })).toBe(
      'no_permission',
    );
  });

  // Y el que importa de verdad: decir «sin conexión» en un partido sin empezar mandaría
  // al entrenador a buscar cobertura para algo que tampoco podría hacer con ella.
  it('partido sin empezar gana sobre sin red', () => {
    expect(eventEditAvailability({ canRecord: true, online: false, status: 'not_started' })).toBe(
      'not_editable',
    );
  });
});
