import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLineupFromClient } from '../writes';
import { defaultLineupDraft } from '../formations';
import type { Database } from '../../supabase/types';

/**
 * createLineupFromClient — CREAR la alineación (cabecera + banquillo sembrado).
 *
 * La regla «sembrar con los convocados» estaba escrita dos veces en web y las dos
 * copias NO coincidían: la acción explícita no sembraba a los jugadores SUBIDOS
 * (`player_promotions`, D2.1) y el auto-crear de la pantalla sí. Aquí vive una sola
 * vez, y estos tests fijan cuál ganó — incluido el caso del subido, que es el que
 * estaba mal en el camino explícito.
 *
 * Lo otro que fijan es la honradez del resultado: no hay transacción sobre PostgREST,
 * así que si la siembra falla la cabecera YA está escrita y la función NO puede
 * devolver «no se ha creado» (el llamador crearía otra). Devuelve `ok: true` con
 * `seedError`, y es el llamador quien decide qué avisa.
 */

const EVENT = 'eeeeeeee-0000-4000-8000-000000000001';
const TEAM = 'tttttttt-0000-4000-8000-000000000002';
const NUEVA = 'llllllll-0000-4000-8000-000000000003';
const TORNEO = 'cccccccc-0000-4000-8000-000000000004';

type Recorded = { table: string; payload: unknown; filters: Record<string, unknown> };

type ClientOpts = {
  /** events → null = no existe. */
  event?: {
    team_id?: string | null;
    starts_at?: string;
    tournament_id?: string | null;
    format?: string;
  } | null;
  /** team_members del equipo (con sus fechas, para el roster histórico). */
  roster?: Array<{ player_id: string; joined_at: string; left_at: string | null }>;
  /** player_promotions de ESTE evento (jugadores subidos). */
  promociones?: Array<{ player_id: string }>;
  /** callup_decisions del ancla de convocatoria. */
  decisiones?: Array<{ player_id: string; decision: string }>;
  /**
   * Con qué `event_id` tienen que PEDIRSE esas decisiones para que el mock las
   * devuelva. Es lo que da dientes al test del torneo: si core lee del partido en
   * vez de la cabecera, el mock devuelve vacío y el descartado se siembra.
   */
  decisionesPara?: string;
  userId?: string | null;
  /** Fila devuelta por el insert de la cabecera (null → insert sin fila). */
  creada?: Record<string, unknown> | null;
  failOn?: { table: string; message?: string; code?: string };
};

function makeClient(opts: ClientOpts) {
  const inserts: Recorded[] = [];

  const evento =
    opts.event === null
      ? null
      : {
          id: EVENT,
          team_id: opts.event?.team_id === undefined ? TEAM : opts.event.team_id,
          starts_at: opts.event?.starts_at ?? '2026-10-24T08:00:00Z',
          tournament_id: opts.event?.tournament_id ?? null,
          teams: { format: opts.event?.format ?? 'F7' },
        };

  const listFor = (table: string, filters: Record<string, unknown>): unknown[] => {
    switch (table) {
      case 'team_members':
        return opts.roster ?? [];
      case 'player_promotions':
        return opts.promociones ?? [];
      case 'callup_decisions':
        // Solo si se piden con el ancla esperada (por defecto, el propio partido).
        return filters['event_id'] === (opts.decisionesPara ?? EVENT)
          ? (opts.decisiones ?? [])
          : [];
      default:
        return [];
    }
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const err = () =>
      opts.failOn && opts.failOn.table === table
        ? { error: { message: opts.failOn.message, code: opts.failOn.code } }
        : { error: null };

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.lte = (col: string, val: unknown) => {
      filters[`lte:${col}`] = val;
      return builder;
    };
    builder.order = () => builder;
    builder.maybeSingle = async () => ({ data: evento });
    builder.then = (resolve: (v: { data: unknown[] }) => unknown) =>
      resolve({ data: listFor(table, filters) });

    builder.insert = (payload: unknown) => {
      inserts.push({ table, payload, filters: { ...filters } });
      // La cabecera se inserta con `.select(...).maybeSingle()`; el banquillo no.
      const tras: Record<string, unknown> = {};
      tras.select = () => tras;
      tras.maybeSingle = async () => ({
        data:
          opts.creada === undefined
            ? {
                id: NUEVA,
                name: 'Plan A',
                formation_code: '1-3-2-1',
                is_official: false,
                visibility: 'staff',
              }
            : opts.creada,
        ...err(),
      });
      tras.then = (resolve: (v: unknown) => unknown) => resolve(err());
      return tras;
    };
    return builder;
  };

  const client = {
    from,
    auth: {
      getUser: async () => ({
        data: { user: opts.userId === null ? null : { id: opts.userId ?? 'u-1' } },
      }),
    },
  } as unknown as SupabaseClient<Database>;

  return { client, inserts };
}

const DEL_ROSTER = [
  { player_id: 'p-1', joined_at: '2026-08-01', left_at: null },
  { player_id: 'p-2', joined_at: '2026-08-01', left_at: null },
];

describe('createLineupFromClient · lo que NO escribe', () => {
  it('input inválido → invalid y no toca la BD', async () => {
    const { client, inserts } = makeClient({});
    const r = await createLineupFromClient(client, { event_id: 'no-es-uuid' });
    expect(r).toEqual({ ok: false, error: 'invalid' });
    expect(inserts, 'un input inválido no puede dejar escrituras').toEqual([]);
  });

  it('sin sesión → forbidden y no toca la BD', async () => {
    const { client, inserts } = makeClient({ userId: null });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(inserts).toEqual([]);
  });

  it('el evento no existe → not_found, sin cabecera', async () => {
    const { client, inserts } = makeClient({ event: null });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(inserts).toEqual([]);
  });

  it('evento sin equipo → event_without_team, sin cabecera', async () => {
    const { client, inserts } = makeClient({ event: { team_id: null } });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'event_without_team' });
    expect(inserts, 'sin equipo no se puede sembrar: no se crea nada').toEqual([]);
  });

  it('la RLS rechaza la cabecera (42501) → forbidden y NO se intenta sembrar', async () => {
    const { client, inserts } = makeClient({
      roster: DEL_ROSTER,
      failOn: { table: 'lineups', code: '42501' },
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(inserts.filter((i) => i.table === 'lineup_positions')).toEqual([]);
  });
});

describe('createLineupFromClient · la cabecera', () => {
  it('sin nombre ni formación usa el borrador por defecto de la MODALIDAD', async () => {
    const draft = defaultLineupDraft('F7');
    expect(draft.formationCode, 'premisa: el catálogo da una formación para F7').toBeTruthy();

    const { client, inserts } = makeClient({ event: { format: 'F7' }, roster: DEL_ROSTER });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok).toBe(true);
    const cabecera = inserts.find((i) => i.table === 'lineups');
    expect(cabecera!.payload).toMatchObject({
      event_id: EVENT,
      name: draft.name,
      formation_code: draft.formationCode,
      created_by: 'u-1',
    });
  });

  it('con nombre y formación dados, no se pisan con el borrador', async () => {
    const { client, inserts } = makeClient({ roster: DEL_ROSTER });
    const r = await createLineupFromClient(client, {
      event_id: EVENT,
      name: 'Plan B',
      formation_code: '1-3-2-1',
    });
    expect(r.ok).toBe(true);
    expect(inserts.find((i) => i.table === 'lineups')!.payload).toMatchObject({
      name: 'Plan B',
      formation_code: '1-3-2-1',
    });
  });

  it('el insert no devuelve fila → generic', async () => {
    const { client } = makeClient({ creada: null, roster: DEL_ROSTER });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r).toEqual({ ok: false, error: 'generic' });
  });
});

describe('createLineupFromClient · a quién siembra en el banquillo', () => {
  it('siembra el roster a la fecha, al banquillo y con el lineup nuevo', async () => {
    const { client, inserts } = makeClient({ roster: DEL_ROSTER });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1', 'p-2']);
    expect(r.ok && r.seedError).toBe(null);
    const banquillo = inserts.find((i) => i.table === 'lineup_positions');
    expect(banquillo!.payload).toEqual([
      { lineup_id: NUEVA, player_id: 'p-1', location: 'bench' },
      { lineup_id: NUEVA, player_id: 'p-2', location: 'bench' },
    ]);
  });

  it('EL JUGADOR SUBIDO TAMBIÉN (D2.1): es el caso que el camino explícito de web no sembraba', async () => {
    const { client } = makeClient({
      roster: DEL_ROSTER,
      promociones: [{ player_id: 'subido-1' }],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1', 'p-2', 'subido-1']);
  });

  it('un subido que YA está en el roster no se duplica', async () => {
    const { client } = makeClient({
      roster: DEL_ROSTER,
      promociones: [{ player_id: 'p-2' }],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1', 'p-2']);
  });

  it('un DESCARTADO no se siembra', async () => {
    const { client } = makeClient({
      roster: DEL_ROSTER,
      decisiones: [{ player_id: 'p-1', decision: 'discarded' }],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-2']);
  });

  it('un CONVOCADO explícito sí se siembra (solo el descarte excluye)', async () => {
    const { client } = makeClient({
      roster: DEL_ROSTER,
      decisiones: [{ player_id: 'p-1', decision: 'called_up' }],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1', 'p-2']);
  });

  it('el que dejó el equipo antes del partido queda fuera (roster histórico)', async () => {
    const { client } = makeClient({
      event: { starts_at: '2026-10-24T08:00:00Z' },
      roster: [
        { player_id: 'p-1', joined_at: '2026-08-01', left_at: null },
        { player_id: 'se-fue', joined_at: '2026-08-01', left_at: '2026-09-30' },
        { player_id: 'se-va-despues', joined_at: '2026-08-01', left_at: '2026-11-30' },
      ],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1', 'se-va-despues']);
  });

  it('partido de TORNEO: la convocatoria se lee de la CABECERA, no del partido (F13B)', async () => {
    // El descarte vive en la CABECERA del torneo y el mock solo lo entrega si se
    // pide con ese id: si core leyera del partido, p-2 se sembraría.
    const { client } = makeClient({
      event: { tournament_id: TORNEO },
      roster: DEL_ROSTER,
      decisiones: [{ player_id: 'p-2', decision: 'discarded' }],
      decisionesPara: TORNEO,
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1']);
  });

  it('partido NORMAL: las decisiones se leen del propio partido', async () => {
    // Control del test de arriba: con el descarte anclado al PARTIDO, el mismo
    // mecanismo tiene que excluirlo. Si no, el test del torneo pasaría por vacío.
    const { client } = makeClient({
      roster: DEL_ROSTER,
      decisiones: [{ player_id: 'p-2', decision: 'discarded' }],
      decisionesPara: EVENT,
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual(['p-1']);
  });

  it('todos descartados → no se intenta insertar banquillo vacío', async () => {
    const { client, inserts } = makeClient({
      roster: DEL_ROSTER,
      decisiones: [
        { player_id: 'p-1', decision: 'discarded' },
        { player_id: 'p-2', decision: 'discarded' },
      ],
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok && r.seeded).toEqual([]);
    expect(inserts.filter((i) => i.table === 'lineup_positions')).toEqual([]);
  });
});

describe('createLineupFromClient · la siembra es best-effort y se devuelve', () => {
  it('si falla el banquillo la cabecera YA existe: ok true con seedError, no un falso fallo', async () => {
    const { client, inserts } = makeClient({
      roster: DEL_ROSTER,
      failOn: { table: 'lineup_positions', code: '42501' },
    });
    const r = await createLineupFromClient(client, { event_id: EVENT });
    expect(r.ok, 'la cabecera se escribió: decir que no se creó haría crear otra').toBe(true);
    expect(r.ok && r.seedError).toBe('forbidden');
    expect(r.ok && r.lineup.id).toBe(NUEVA);
    expect(inserts.filter((i) => i.table === 'lineups')).toHaveLength(1);
  });
});
