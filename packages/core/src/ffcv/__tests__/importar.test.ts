import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  filaDeEvento,
  importarCalendarioDeEquipoFromClient,
  importarCalendariosFromClient,
  leerEquiposDelClubFromClient,
  revisarPartido,
  type EquipoParaImportar,
} from '../importar';
import type { FfcvFetch, PartidoCrudo, PartidoFfcv } from '../types';

const EQUIPO: EquipoParaImportar = {
  teamId: '0091eb5b-d8f0-43c3-9c63-3b371a81cd9c',
  clubId: '194df434-34e1-4b21-b659-e203f3231142',
  nombre: 'Infantil B',
  ffcvTeamCode: '15140',
  ffcvSeasonCode: '22',
  ffcvCompetitionCode: '905431987',
  ffcvGroupCode: '905432005',
};
const ACTOR = 'aaaaaaaa-0000-4000-8000-000000000001';

/** La jornada 1 REAL del Infantil B. */
const J1: PartidoCrudo = {
  campo: 'Polideportivo Mpal. de Nazaret F-11',
  cod_equipo_local: '906821360',
  cod_equipo_visitante: '15140',
  codacta: '26539172',
  estado: '0',
  fecha: '18/10/2026',
  hora: '10:30',
  local: "C.D. At. Nazaret 'C'",
  visitante: "U.D. Fonteta 'B'",
};
/** La jornada 2 REAL: en casa, a las 16:00 del sábado. */
const J2: PartidoCrudo = {
  campo: 'Polideportivo Mpal. Quatre Carreres F-11',
  cod_equipo_local: '15140',
  cod_equipo_visitante: '900100100',
  codacta: '26539179',
  estado: '0',
  fecha: '24/10/2026',
  hora: '16:00',
  local: "U.D. Fonteta 'B'",
  visitante: "C.D. Jesuitas Valencia-S. Fútbol 'E'",
};

/** Doble de la API: dos jornadas, con los partidos que se le pasen. */
function apiConJornadas(porJornada: Record<string, PartidoCrudo[]>): FfcvFetch {
  return async (url) => {
    if (url.includes('jornadas_fetch')) {
      return new Response(
        JSON.stringify({
          estado: '1',
          jornadas: Object.keys(porJornada).map((j) => ({ codjornada: j })),
        }),
        { status: 200 },
      );
    }
    const m = /cod_jornada=(\d+)/.exec(url);
    const j = m?.[1] ?? '1';
    return new Response(
      JSON.stringify({ estado: '1', jornada: j, partidos: porJornada[j] ?? [] }),
      { status: 200 },
    );
  };
}
const CFG = { token: 'a'.repeat(64), esperar: async () => {}, intentos: 2 };

type Insercion = Record<string, unknown>;

/**
 * Cliente falso. `update` LANZA a propósito: la decisión 3 dice que un partido que ya
 * existe no se toca, y si alguien añadiera una ruta de actualización este doble lo grita
 * en vez de dejarlo pasar.
 */
function cliente(opciones: {
  actas?: (string | null)[];
  errorLectura?: { message: string };
  errorInsert?: { message: string; code?: string };
  equipos?: Record<string, unknown>[];
}): { db: SupabaseClient<Database>; inserciones: Insercion[] } {
  const inserciones: Insercion[] = [];
  const lecturaEventos = {
    select: () => lecturaEventos,
    eq: () => lecturaEventos,
    order: () => lecturaEventos,
    not: () =>
      Promise.resolve(
        opciones.errorLectura
          ? { data: null, error: opciones.errorLectura }
          : { data: (opciones.actas ?? []).map((a) => ({ ffcv_match_code: a })), error: null },
      ),
  };
  const lecturaEquipos = {
    select: () => lecturaEquipos,
    eq: () => lecturaEquipos,
    order: () => Promise.resolve({ data: opciones.equipos ?? [], error: null }),
  };
  const db = {
    from: (tabla: string) => ({
      ...(tabla === 'teams' ? lecturaEquipos : lecturaEventos),
      insert: (fila: Insercion) => {
        inserciones.push(fila);
        return Promise.resolve({ error: opciones.errorInsert ?? null });
      },
      update: () => {
        throw new Error('SOLO CREA: nadie debe actualizar un partido ya existente');
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { db, inserciones };
}

describe('importarCalendarioDeEquipoFromClient', () => {
  it('crea los que faltan y NO toca los que ya están', async () => {
    const { db, inserciones } = cliente({ actas: ['26539172'] });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1], '2': [J2] }) },
    });
    expect(r.leidos).toBe(2);
    expect(r.yaEstaban).toBe(1);
    expect(r.creados).toBe(1);
    expect(r.omitidos).toEqual([]);
    expect(r.fallo).toBeNull();
    // Solo se ha insertado el que faltaba, y ninguna actualización (el doble lanzaría).
    expect(inserciones).toHaveLength(1);
    expect(inserciones[0]).toMatchObject({ ffcv_match_code: '26539179' });
  });

  it('la fila que escribe lleva lo acordado, y el título con el orden de la FFCV', async () => {
    const { db, inserciones } = cliente({
      actas: [],
      equipos: [],
    });
    await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
      direccionDe: (campo) =>
        campo === 'Polideportivo Mpal. de Nazaret F-11'
          ? 'Carrer Fernando Morais de la Horra, 46024 Valencia'
          : null,
    });
    expect(inserciones[0]).toEqual({
      club_id: EQUIPO.clubId,
      team_id: EQUIPO.teamId,
      type: 'match',
      // Fuera de casa: primero el rival.
      title: 'C.D. At. Nazaret C - Infantil B',
      starts_at: '2026-10-18T08:30:00.000Z',
      ends_at: null,
      all_day: false,
      location_name: 'Polideportivo Mpal. de Nazaret F-11',
      location_address: 'Carrer Fernando Morais de la Horra, 46024 Valencia',
      opponent_name: 'C.D. At. Nazaret C',
      notes: null,
      created_by: ACTOR,
      ffcv_match_code: '26539172',
      ffcv_round: 1,
    });
  });

  it('sin dirección resuelta, el evento entra igual con el nombre del campo', async () => {
    const { db, inserciones } = cliente({ actas: [] });
    await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
      direccionDe: () => null,
    });
    expect(inserciones[0]).toMatchObject({
      location_name: 'Polideportivo Mpal. de Nazaret F-11',
      location_address: null,
    });
  });

  it('si la lectura de events falla, NO inserta nada: duplicaría los 26', async () => {
    const { db, inserciones } = cliente({ errorLectura: { message: 'boom' } });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.fallo?.motivo).toBe('api');
    expect(r.creados).toBe(0);
    expect(inserciones).toHaveLength(0);
  });

  it('un 23505 es «ya estaba», no un omitido: el único de F-2 ha mordido', async () => {
    const { db } = cliente({ actas: [], errorInsert: { message: 'duplicate key', code: '23505' } });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.yaEstaban).toBe(1);
    expect(r.creados).toBe(0);
    expect(r.omitidos).toEqual([]);
  });

  it('otro error de la base sí es un omitido, con su motivo', async () => {
    const { db } = cliente({ actas: [], errorInsert: { message: 'violates check constraint' } });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.creados).toBe(0);
    expect(r.omitidos).toEqual([{ acta: '26539172', motivo: 'violates check constraint' }]);
  });

  it('si el lector falla (origen degradado), el equipo entero queda sin tocar', async () => {
    const { db, inserciones } = cliente({ actas: [] });
    const degradado: FfcvFetch = async () =>
      new Response(JSON.stringify({ jornadas: [], _source: 'degraded_empty' }), { status: 200 });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: degradado },
    });
    expect(r.fallo?.motivo).toBe('degradado');
    expect(inserciones).toHaveLength(0);
  });
});

describe('importarCalendariosFromClient · aislar por equipo (decisión 2)', () => {
  it('el fallo de un equipo no impide el siguiente', async () => {
    const { db, inserciones } = cliente({ actas: [] });
    const otro: EquipoParaImportar = { ...EQUIPO, teamId: 'otro-team', nombre: 'Infantil C', ffcvTeamCode: '900463025' };
    // La API responde mal SOLO para el grupo del primer equipo.
    const fetchImpl: FfcvFetch = async (url) => {
      if (url.includes('cod_grupo=905432005') || url.includes('905432005')) {
        return new Response(JSON.stringify({ jornadas: [], _source: 'degraded_empty' }), {
          status: 200,
        });
      }
      return apiConJornadas({ '1': [{ ...J1, cod_equipo_visitante: '900463025' }] })(url);
    };
    const rs = await importarCalendariosFromClient(
      db,
      [EQUIPO, { ...otro, ffcvGroupCode: 'g-otro' }],
      { actorProfileId: ACTOR, cfg: { ...CFG, fetchImpl } },
    );
    expect(rs).toHaveLength(2);
    expect(rs[0]?.fallo?.motivo).toBe('degradado');
    expect(rs[0]?.creados).toBe(0);
    expect(rs[1]?.fallo).toBeNull();
    expect(rs[1]?.creados).toBe(1);
    expect(inserciones).toHaveLength(1);
  });
});

describe('revisarPartido · los CHECK de la tabla, antes de la base', () => {
  const p: PartidoFfcv = {
    acta: '1',
    jornada: 1,
    fechaHoraIso: '2026-10-18T08:30:00.000Z',
    enCasa: true,
    rival: 'X',
    codigoRival: '2',
    campo: 'C',
    jugado: false,
  };

  it('acepta un partido normal', () => {
    expect(revisarPartido('Infantil B', p)).toEqual({ titulo: 'Infantil B - X' });
  });

  it('un título imposible se omite con motivo, no se manda a la base', () => {
    const r = revisarPartido('A'.repeat(150), { ...p, rival: 'B'.repeat(60) });
    expect(r).toHaveProperty('motivo');
  });

  it('una jornada fuera de rango se omite (CHECK events_ffcv_round_positive)', () => {
    expect(revisarPartido('Infantil B', { ...p, jornada: 0 })).toHaveProperty('motivo');
    expect(revisarPartido('Infantil B', { ...p, jornada: 201 })).toHaveProperty('motivo');
  });
});

describe('leerEquiposDelClubFromClient', () => {
  it('separa los importables de los que faltan por ubicar y los no vinculados', async () => {
    const { db } = cliente({
      equipos: [
        {
          id: 't1',
          name: 'Infantil B',
          club_id: 'c1',
          ffcv_team_code: '15140',
          ffcv_season_code: '22',
          ffcv_competition_code: '905431987',
          ffcv_group_code: '905432005',
        },
        {
          id: 't2',
          name: 'Alevín A',
          club_id: 'c1',
          ffcv_team_code: '15141',
          ffcv_season_code: '22',
          ffcv_competition_code: null,
          ffcv_group_code: null,
        },
        { id: 't3', name: 'Senior A', club_id: 'c1', ffcv_team_code: null },
      ],
    });
    const r = await leerEquiposDelClubFromClient(db, { clubId: 'c1', season: '2026-27' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.importables.map((e) => e.nombre)).toEqual(['Infantil B']);
    expect(r.datos.sinUbicacion.map((e) => e.nombre)).toEqual(['Alevín A']);
    expect(r.datos.sinVincular.map((e) => e.nombre)).toEqual(['Senior A']);
  });
});

describe('filaDeEvento', () => {
  it('no inventa ends_at ni notas', () => {
    const fila = filaDeEvento(
      EQUIPO,
      {
        acta: '26539172',
        jornada: 1,
        fechaHoraIso: '2026-10-18T08:30:00.000Z',
        enCasa: true,
        rival: 'R',
        codigoRival: '9',
        campo: 'C',
        jugado: false,
      },
      'T',
      ACTOR,
      null,
    );
    expect(fila.ends_at).toBeNull();
    expect(fila.notes).toBeNull();
    expect(fila.all_day).toBe(false);
    expect(fila.type).toBe('match');
  });
});
