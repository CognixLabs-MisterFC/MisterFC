import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  countSubs,
  deriveLiveSquad,
  getLiveSquadInputsFromClient,
  getSubstitutionRegimeFromClient,
} from '../live-squad';
import { DEFAULT_REGIME } from '../regime';
import type { LiveSquadInputs } from '../live-squad';

/**
 * Lo que se protege aquí no es «la consulta devuelve filas», es la pregunta que
 * el entrenador hace con el pulgar en mitad de un partido: ¿a quién puedo sacar y
 * a quién puedo meter?
 *
 * Importa porque la respuesta no se queda en el acta. `playing-time` reparte los
 * minutos POR los eventos de sustitución, y esos minutos acaban en la ficha de
 * cada crío: un cambio apuntado sobre el jugador equivocado es un minutaje
 * equivocado para dos niños, y nadie lo va a notar leyendo la lista.
 */

type Res = { data: unknown; error?: { message: string } | null };

/**
 * Mock del cliente por TABLA. Cada tabla devuelve sus filas; se registra el orden
 * pedido para poder aseverarlo (las sustituciones encadenan por hueco: leerlas al
 * revés deja dentro al que salió).
 */
function makeClient(tablas: Record<string, Res>) {
  const pedido: { tabla: string; orderCol?: string; ascending?: boolean }[] = [];
  const sb = {
    from: (tabla: string) => {
      const registro: { tabla: string; orderCol?: string; ascending?: boolean } = { tabla };
      pedido.push(registro);
      const res = tablas[tabla] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data,
          error: res.error ?? null,
        });
      chain.order = (col: string, opts: { ascending: boolean }) => {
        registro.orderCol = col;
        registro.ascending = opts.ascending;
        return Promise.resolve({ data: res.data ?? [], error: res.error ?? null });
      };
      // Sin `order` ni `maybeSingle`: la consulta se resuelve al await.
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: res.data ?? [], error: res.error ?? null });
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, pedido };
}

const EVENTO = 'evt-1';

/** Alineación oficial: tres titulares colocados y dos suplentes. */
const POSICIONES = [
  { player_id: 'T1', position_code: 'GK', x_pct: 50, y_pct: 95, location: 'field' },
  { player_id: 'T2', position_code: 'DF', x_pct: 30, y_pct: 60, location: 'field' },
  { player_id: 'T3', position_code: 'FW', x_pct: 50, y_pct: 20, location: 'field' },
  { player_id: 'S1', position_code: null, x_pct: null, y_pct: null, location: 'bench' },
  { player_id: 'S2', position_code: null, x_pct: null, y_pct: null, location: 'bench' },
];

function clienteCompleto(opts?: {
  eventos?: unknown[];
  ausencias?: unknown[];
  regimen?: unknown;
}) {
  return makeClient({
    lineups: { data: [{ id: 'lin-1' }] },
    lineup_positions: { data: POSICIONES },
    match_events: { data: opts?.eventos ?? [] },
    match_absences: { data: opts?.ausencias ?? [] },
    events: { data: [{ teams: { division: 'primera', categories: { kind: 'infantil' } } }] },
    substitution_regimes: { data: opts?.regimen === undefined ? [] : [opts.regimen] },
  });
}

describe('getLiveSquadInputsFromClient — lo que hay que leer', () => {
  // ANCLA POSITIVA: si el mock no respondiera por los nombres buenos, todo lo de
  // abajo saldría «bien» con el once vacío, que es el verde del vacío.
  it('lee la alineación oficial: huecos de campo y banquillo', async () => {
    const { sb } = clienteCompleto();
    const inputs = await getLiveSquadInputsFromClient(sb, EVENTO);
    expect(inputs.slots.map((s) => s.playerId)).toEqual(['T1', 'T2', 'T3']);
    expect(inputs.slots[1]).toEqual({
      playerId: 'T2',
      positionCode: 'DF',
      xPct: 30,
      yPct: 60,
    });
    expect(inputs.bench).toEqual(['S1', 'S2']);
  });

  it('las sustituciones se piden EN ORDEN cronológico', async () => {
    const { sb, pedido } = clienteCompleto();
    await getLiveSquadInputsFromClient(sb, EVENTO);
    const eventos = pedido.find((p) => p.tabla === 'match_events');
    // `deriveSquad` encadena ocupantes por hueco: dos cambios sobre el mismo hueco
    // leídos al revés dejarían en el campo al que salió.
    expect(eventos?.orderCol).toBe('clock_seconds');
    expect(eventos?.ascending).toBe(true);
  });

  it('separa cambios de tarjetas, y dos amarillas son una expulsión', async () => {
    const { sb } = clienteCompleto({
      eventos: [
        { type: 'substitution', player_id: 'T2', related_player_id: 'S1', clock_seconds: 600 },
        { type: 'yellow_card', player_id: 'T3', related_player_id: null, clock_seconds: 700 },
        { type: 'yellow_card', player_id: 'T3', related_player_id: null, clock_seconds: 900 },
        { type: 'goal', player_id: 'T1', related_player_id: null, clock_seconds: 950 },
      ],
    });
    const inputs = await getLiveSquadInputsFromClient(sb, EVENTO);
    expect(inputs.subs).toEqual([{ out: 'T2', in: 'S1' }]);
    expect(inputs.expelled).toEqual(['T3']);
  });

  it('una sustitución a medias (sin quien entra) no se cuenta', async () => {
    const { sb } = clienteCompleto({
      eventos: [
        { type: 'substitution', player_id: 'T2', related_player_id: null, clock_seconds: 600 },
      ],
    });
    expect((await getLiveSquadInputsFromClient(sb, EVENTO)).subs).toEqual([]);
  });

  it('las ausencias llegan de match_absences', async () => {
    const { sb } = clienteCompleto({ ausencias: [{ player_id: 'S2' }] });
    expect((await getLiveSquadInputsFromClient(sb, EVENTO)).absent).toEqual(['S2']);
  });

  it('sin alineación oficial no hay huecos, y eso NO es un fallo', async () => {
    const { sb } = makeClient({
      lineups: { data: [] },
      match_events: { data: [] },
      match_absences: { data: [] },
      events: { data: [{ teams: { division: 'primera', categories: { kind: 'infantil' } } }] },
      substitution_regimes: { data: [] },
    });
    const inputs = await getLiveSquadInputsFromClient(sb, EVENTO);
    expect(inputs.slots).toEqual([]);
    expect(deriveLiveSquad(inputs).onFieldIds).toEqual([]);
  });
});

describe('el régimen decide la reentrada, y su hueco es RESTRICTIVO', () => {
  it('con fila, manda la fila', async () => {
    const { sb } = clienteCompleto({
      regimen: { regime_type: 'rolling', max_subs: null, allow_reentry: true },
    });
    const r = await getSubstitutionRegimeFromClient(sb, EVENTO);
    expect(r).toEqual({ type: 'rolling', maxSubs: null, allowReentry: true });
  });

  // Un hueco en los datos de referencia no puede regalar cambios ilimitados en
  // silencio: sin fila se cae al DEFAULT, que es el restrictivo.
  it('sin fila de régimen, el DEFAULT', async () => {
    const { sb } = clienteCompleto();
    expect(await getSubstitutionRegimeFromClient(sb, EVENTO)).toEqual(DEFAULT_REGIME);
  });

  it('sin división o sin tipo de categoría, también el DEFAULT', async () => {
    const { sb } = makeClient({
      events: { data: [{ teams: { division: null, categories: { kind: 'infantil' } } }] },
    });
    expect(await getSubstitutionRegimeFromClient(sb, EVENTO)).toEqual(DEFAULT_REGIME);
  });
});

describe('deriveLiveSquad — la pregunta del pulgar', () => {
  const base: LiveSquadInputs = {
    slots: [
      { playerId: 'T1', positionCode: 'GK', xPct: 50, yPct: 95 },
      { playerId: 'T2', positionCode: 'DF', xPct: 30, yPct: 60 },
      { playerId: 'T3', positionCode: 'FW', xPct: 50, yPct: 20 },
    ],
    bench: ['S1', 'S2'],
    subs: [],
    expelled: [],
    absent: [],
    regime: DEFAULT_REGIME,
  };

  /**
   * EL CASO QUE MOTIVA TODA LA PIEZA. Antes, «quién sale» eran los titulares de la
   * alineación oficial y «quién entra» el resto de la convocatoria, así que tras
   * este mismo cambio la app seguía ofreciendo a T2 para salir (ya estaba fuera) y
   * no ofrecía a S1 (acababa de entrar).
   */
  it('tras un cambio, sale el que ENTRÓ y el que salió ya no está en el campo', () => {
    const sq = deriveLiveSquad({ ...base, subs: [{ out: 'T2', in: 'S1' }] });
    expect(sq.onFieldIds).toEqual(['T1', 'S1', 'T3']);
    expect(sq.onFieldIds).not.toContain('T2');
    // Y con el régimen por defecto (sin reentrada) T2 no puede volver a entrar.
    expect(sq.eligibleInIds).toEqual(['S2']);
  });

  it('con reentrada permitida, el que salió vuelve a estar disponible', () => {
    const sq = deriveLiveSquad({
      ...base,
      subs: [{ out: 'T2', in: 'S1' }],
      regime: { type: 'rolling', maxSubs: null, allowReentry: true },
    });
    expect(sq.eligibleInIds.sort()).toEqual(['S2', 'T2']);
  });

  /**
   * La segunda mitad, y la que hace que la pantalla responda al instante: la app
   * encola los eventos y los sube cuando puede. Sin sumar los pendientes, el
   * entrenador toca un cambio y las listas no se mueven hasta que la fila llega al
   * servidor — en la pantalla donde acaba de tocar, y a veces sin cobertura.
   */
  it('las sustituciones PENDIENTES de subir cuentan igual', () => {
    const sq = deriveLiveSquad(base, [{ out: 'T3', in: 'S2' }]);
    expect(sq.onFieldIds).toEqual(['T1', 'T2', 'S2']);
    expect(countSubs(base, [{ out: 'T3', in: 'S2' }])).toBe(1);
  });

  it('van DETRÁS de las persistidas: dos cambios seguidos sobre el mismo hueco', () => {
    const sq = deriveLiveSquad({ ...base, subs: [{ out: 'T2', in: 'S1' }] }, [
      { out: 'S1', in: 'S2' },
    ]);
    // Si el pendiente se aplicara antes, S1 no estaría en el campo para salir y el
    // hueco se quedaría con el jugador equivocado.
    expect(sq.onFieldIds).toEqual(['T1', 'S2', 'T3']);
  });

  it('un expulsado no está en el campo ni puede entrar', () => {
    const sq = deriveLiveSquad({ ...base, expelled: ['T3'] });
    expect(sq.onFieldIds).toEqual(['T1', 'T2']);
    expect(sq.eligibleInIds).not.toContain('T3');
  });

  it('un ausente tampoco', () => {
    const sq = deriveLiveSquad({ ...base, absent: ['S1'] });
    expect(sq.eligibleInIds).toEqual(['S2']);
  });
});
