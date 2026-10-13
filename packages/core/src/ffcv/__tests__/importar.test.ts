import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  COLUMNAS_DE_LA_FFCV,
  cambiosDelPartido,
  filaDeEvento,
  importarCalendarioDeEquipoFromClient,
  importarCalendariosFromClient,
  importarEquipoConDireccionesFromClient,
  leerEquiposDelClubFromClient,
  prepararImportacionFromClient,
  revisarPartido,
  veredictoDeEquipo,
  veredictoDeRespuesta,
  type EquipoParaImportar,
  type EventoExistente,
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
 * La jornada 1 TAL COMO ESTÁ EN LA BASE tras el alta del 2026-10-12. Sirve para el caso
 * normal del repaso: la FFCV no ha movido nada y no debe escribirse ni una fila.
 *
 * Ojo al `starts_at`: la base lo devuelve con `+00:00` y nosotros construimos `.000Z`.
 * Son el MISMO instante escritos distinto, y por eso el fixture usa la forma de la base:
 * si la comparación fuera textual, este test sería el que lo cazara.
 */
const FILA_J1_EN_LA_BASE: Partial<EventoExistente & { ffcv_match_code: string }> = {
  id: 'e0000000-0000-4000-8000-000000000001',
  ffcv_match_code: '26539172',
  starts_at: '2026-10-18T08:30:00+00:00',
  title: 'C.D. At. Nazaret C - Infantil B',
  location_name: 'Polideportivo Mpal. de Nazaret F-11',
  location_address: null,
  opponent_name: 'C.D. At. Nazaret C',
  ffcv_round: 1,
};

/**
 * Cliente falso.
 *
 * ── EL GRITO QUE CAMBIA, Y POR QUÉ ──────────────────────────────────────────────────
 * Hasta el 2026-10-13 este doble tenía `update` LANZANDO una excepción, porque la
 * decisión era «solo crea» y queríamos que cualquier ruta de actualización colada se
 * delatara. Esa alarma hizo su trabajo: salta en cuanto se añadió el repaso.
 *
 * Ahora actualizar es lo que se pide, así que el doble lo DEJA pasar — pero sigue
 * gritando si el parche toca una columna que NO es de la FFCV. Eso es justo lo que no
 * debe pasar nunca: el repaso no puede llevarse por delante las notas del entrenador, la
 * aprobación ni la cancelación.
 */
function cliente(opciones: {
  /** Actas que ya existen, con los valores que tienen en la base. */
  eventos?: Partial<EventoExistente & { ffcv_match_code: string }>[];
  errorLectura?: { message: string };
  errorInsert?: { message: string; code?: string };
  errorUpdate?: { message: string };
  equipos?: Record<string, unknown>[];
}): { db: SupabaseClient<Database>; inserciones: Insercion[]; parches: Insercion[] } {
  const inserciones: Insercion[] = [];
  const parches: Insercion[] = [];
  const lecturaEventos = {
    select: () => lecturaEventos,
    eq: () => lecturaEventos,
    order: () => lecturaEventos,
    not: () =>
      Promise.resolve(
        opciones.errorLectura
          ? { data: null, error: opciones.errorLectura }
          : { data: opciones.eventos ?? [], error: null },
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
      update: (parche: Insercion) => {
        for (const clave of Object.keys(parche)) {
          if (!(COLUMNAS_DE_LA_FFCV as readonly string[]).includes(clave)) {
            throw new Error(
              `el repaso ha tocado \`${clave}\`, que NO es de la FFCV: las notas, la aprobacion y la cancelacion son de MisterFC`,
            );
          }
        }
        parches.push(parche);
        return {
          eq: () => Promise.resolve({ error: opciones.errorUpdate ?? null }),
        };
      },
    }),
  } as unknown as SupabaseClient<Database>;
  return { db, inserciones, parches };
}

describe('importarCalendarioDeEquipoFromClient', () => {
  it('crea los que faltan y NO toca los que ya están', async () => {
    const { db, inserciones } = cliente({ eventos: [FILA_J1_EN_LA_BASE] });
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
      eventos: [],
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
    const { db, inserciones } = cliente({ eventos: [] });
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
    const { db } = cliente({
      eventos: [],
      errorInsert: { message: 'duplicate key', code: '23505' },
    });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.yaEstaban).toBe(1);
    expect(r.creados).toBe(0);
    expect(r.omitidos).toEqual([]);
  });

  it('otro error de la base sí es un omitido, con su motivo', async () => {
    const { db } = cliente({ eventos: [], errorInsert: { message: 'violates check constraint' } });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.creados).toBe(0);
    expect(r.omitidos).toEqual([{ acta: '26539172', motivo: 'violates check constraint' }]);
  });

  it('si el lector falla (origen degradado), el equipo entero queda sin tocar', async () => {
    const { db, inserciones } = cliente({ eventos: [] });
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
    const { db, inserciones } = cliente({ eventos: [] });
    const otro: EquipoParaImportar = {
      ...EQUIPO,
      teamId: 'otro-team',
      nombre: 'Infantil C',
      ffcvTeamCode: '900463025',
    };
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
    horaDeRelleno: false,
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
        horaDeRelleno: false,
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

// ════════════════════════════════════════════════════════════════════════════════════
// LOS DOS VIAJES DEL BOTÓN. El primero trae los equipos y el mapa de direcciones; cada
// uno de los otros quince da de alta los partidos de UN equipo.
// ════════════════════════════════════════════════════════════════════════════════════

/** La ficha REAL del Infantil B: de aquí sale el campo propio, que el catálogo no tiene. */
const FICHA = {
  estado: '1',
  codigo_equipo: '15140',
  nombre_equipo: "U.D. Fonteta 'B'",
  codigo_categoria: '7818',
  codigo_campo: '5338',
  campo: 'Polideportivo Mpal. Quatre Carreres F-11',
};
/** Lo que devuelve `datos_campo.php?codcampo=5338`, literal. */
const CAMPO_PROPIO = {
  nombre_campo: 'Polideportivo Mpal. Quatre Carreres F-11',
  direccion: 'Carrer d`Angel de Villena, s/n',
  localidad: 'Valencia',
  provincia: 'Valencia',
  codigo_postal: '46013',
};
/** Una página de catálogo con el campo de Nazaret y SIN el nuestro, como la de verdad. */
const CATALOGO = {
  estado: '1',
  total_paginas: '1',
  total_registros: '1',
  campos: [
    {
      codigo: '5174',
      nombre: 'Polideportivo Mpal. de Nazaret F-11',
      direccion: 'Carrer Fernando Morais de la Horra',
      localidad: 'Valencia',
      provincia: 'Valencia',
      codigo_postal: '46024',
    },
  ],
};

function apiCompleta(opciones: {
  porJornada?: Record<string, PartidoCrudo[]>;
  catalogo?: unknown;
  ficha?: unknown;
  campo?: unknown;
  statusCatalogo?: number;
}): FfcvFetch {
  const jornadas = apiConJornadas(opciones.porJornada ?? { '1': [J1], '2': [J2] });
  return async (url, init) => {
    if (url.includes('campos.php')) {
      return new Response(JSON.stringify(opciones.catalogo ?? CATALOGO), {
        status: opciones.statusCatalogo ?? 200,
      });
    }
    if (url.includes('ver_equipo')) {
      return new Response(JSON.stringify(opciones.ficha ?? FICHA), { status: 200 });
    }
    if (url.includes('datos_campo')) {
      return new Response(JSON.stringify(opciones.campo ?? CAMPO_PROPIO), { status: 200 });
    }
    return jornadas(url, init);
  };
}

const FILA_EQUIPO = {
  id: EQUIPO.teamId,
  name: EQUIPO.nombre,
  club_id: EQUIPO.clubId,
  ffcv_team_code: EQUIPO.ffcvTeamCode,
  ffcv_season_code: EQUIPO.ffcvSeasonCode,
  ffcv_competition_code: EQUIPO.ffcvCompetitionCode,
  ffcv_group_code: EQUIPO.ffcvGroupCode,
};

describe('prepararImportacionFromClient', () => {
  it('devuelve los equipos importables y el mapa de direcciones del catálogo', async () => {
    const { db } = cliente({ equipos: [FILA_EQUIPO] });
    const r = await prepararImportacionFromClient(
      db,
      { clubId: EQUIPO.clubId, season: '2026-27' },
      { ...CFG, fetchImpl: apiCompleta({}) },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.importables).toHaveLength(1);
    expect(r.datos.direcciones).toEqual({
      'Polideportivo Mpal. de Nazaret F-11': 'Carrer Fernando Morais de la Horra, 46024 Valencia',
    });
  });

  it('si el catálogo falla, FALLA CERRADO en vez de devolver un mapa vacío', async () => {
    // Un mapa a medias presentado como completo convierte «no se pudo leer» en «este
    // campo no tiene direccion», que es la mentira silenciosa de siempre.
    const { db } = cliente({ equipos: [FILA_EQUIPO] });
    const r = await prepararImportacionFromClient(
      db,
      { clubId: EQUIPO.clubId, season: '2026-27' },
      { ...CFG, fetchImpl: apiCompleta({ catalogo: { estado: '1' }, statusCatalogo: 200 }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detalle).toContain('catalogo de campos');
  });
});

describe('importarEquipoConDireccionesFromClient', () => {
  it('EL CASO MEDIDO: el partido en casa se guarda con la dirección que el catálogo NO traía', async () => {
    const { db, inserciones } = cliente({ eventos: [] });
    const r = await importarEquipoConDireccionesFromClient(
      db,
      {
        equipo: EQUIPO,
        direcciones: {
          'Polideportivo Mpal. de Nazaret F-11':
            'Carrer Fernando Morais de la Horra, 46024 Valencia',
        },
        actorProfileId: ACTOR,
      },
      { ...CFG, fetchImpl: apiCompleta({}) },
    );
    expect(r.fallo).toBeNull();
    expect(r.creados).toBe(2);

    const enCasa = inserciones.find((i) => i.ffcv_match_code === '26539179');
    expect(enCasa?.location_address).toBe('Carrer d`Angel de Villena, s/n, 46013 Valencia');
    // Y el de fuera sigue saliendo del catálogo.
    const fuera = inserciones.find((i) => i.ffcv_match_code === '26539172');
    expect(fuera?.location_address).toBe('Carrer Fernando Morais de la Horra, 46024 Valencia');
  });

  it('si el campo propio no se resuelve, el partido se crea IGUAL, sin dirección', async () => {
    const { db, inserciones } = cliente({ eventos: [] });
    const r = await importarEquipoConDireccionesFromClient(
      db,
      { equipo: EQUIPO, direcciones: {}, actorProfileId: ACTOR },
      {
        ...CFG,
        fetchImpl: apiCompleta({
          ficha: { estado: '0', error: 'Respuesta vacía desde NSMApi_Equipos', code_api: 503 },
        }),
      },
    );
    expect(r.fallo).toBeNull();
    expect(r.creados).toBe(2);
    expect(inserciones.every((i) => i.location_address === null)).toBe(true);
    // El NOMBRE del campo sí va: es lo que la familia tenía antes de todo esto.
    expect(inserciones.find((i) => i.ffcv_match_code === '26539179')?.location_name).toBe(
      'Polideportivo Mpal. Quatre Carreres F-11',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// EL REPASO DE LOS MARTES. La FFCV cambia dia y hora cada semana; con «solo crea» el
// calendario se quedaba con la fecha vieja y las familias iban al partido equivocado.
// ════════════════════════════════════════════════════════════════════════════════════

describe('cambiosDelPartido', () => {
  const EXISTENTE = FILA_J1_EN_LA_BASE as EventoExistente;
  const DESEADA = {
    starts_at: '2026-10-18T08:30:00.000Z',
    title: 'C.D. At. Nazaret C - Infantil B',
    location_name: 'Polideportivo Mpal. de Nazaret F-11',
    location_address: null,
    opponent_name: 'C.D. At. Nazaret C',
    ffcv_round: 1,
  };

  it('LA TRAMPA: el mismo instante escrito distinto NO es un cambio', () => {
    // La base da `+00:00`, nosotros `.000Z`. Comparar como texto marcaria los 290
    // partidos como movidos cada martes y reescribiria la tabla entera para nada.
    expect(cambiosDelPartido(EXISTENTE, DESEADA)).toEqual([]);
  });

  it('caza la hora movida, que es el caso de todas las semanas', () => {
    expect(
      cambiosDelPartido(EXISTENTE, { ...DESEADA, starts_at: '2026-10-18T09:00:00.000Z' }),
    ).toEqual(['fecha']);
  });

  it('caza el campo, el titulo, el rival y la jornada, cada uno con su nombre', () => {
    expect(cambiosDelPartido(EXISTENTE, { ...DESEADA, location_name: 'Otro campo' })).toEqual([
      'campo',
    ]);
    expect(
      cambiosDelPartido(EXISTENTE, { ...DESEADA, title: 'Infantil B - C.D. At. Nazaret C' }),
    ).toEqual(['titulo']);
    expect(cambiosDelPartido(EXISTENTE, { ...DESEADA, opponent_name: 'Otro rival' })).toEqual([
      'rival',
    ]);
    expect(cambiosDelPartido(EXISTENTE, { ...DESEADA, ffcv_round: 2 })).toEqual(['jornada']);
    expect(cambiosDelPartido(EXISTENTE, { ...DESEADA, location_address: 'Una calle' })).toEqual([
      'direccion',
    ]);
  });

  it('una fecha ilegible en la base cuenta como cambio, no como igual', () => {
    const roto = { ...EXISTENTE, starts_at: 'no es una fecha' };
    expect(cambiosDelPartido(roto, DESEADA)).toContain('fecha');
  });
});

describe('el repaso dentro del importador', () => {
  it('EL FALLO QUE ESTO ARREGLA: la FFCV mueve la hora y el partido se actualiza', async () => {
    // En la base, la J1 esta a las 08:30Z; la FFCV la da ahora a las 10:30 locales de
    // otro dia. Antes esto se contaba como «ya estaba» y la familia iba a la hora vieja.
    const { db, inserciones, parches } = cliente({
      eventos: [{ ...FILA_J1_EN_LA_BASE, starts_at: '2026-10-17T08:30:00+00:00' }],
    });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.leidos).toBe(1);
    expect(r.yaEstaban).toBe(0);
    expect(r.creados).toBe(0);
    expect(r.actualizados).toEqual([{ acta: '26539172', cambios: ['fecha'] }]);
    expect(inserciones).toHaveLength(0);
    expect(parches).toHaveLength(1);
    expect(parches[0]).toMatchObject({ starts_at: '2026-10-18T08:30:00.000Z' });
  });

  it('el parche SOLO lleva columnas de la FFCV (el doble revienta si no)', async () => {
    const { db, parches } = cliente({
      eventos: [{ ...FILA_J1_EN_LA_BASE, location_name: 'Campo viejo' }],
    });
    await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(Object.keys(parches[0] ?? {}).sort()).toEqual([...COLUMNAS_DE_LA_FFCV].sort());
    // Nada de notas, aprobacion ni cancelacion: son de MisterFC.
    expect(Object.keys(parches[0] ?? {})).not.toContain('notes');
    expect(Object.keys(parches[0] ?? {})).not.toContain('approval_status');
    expect(Object.keys(parches[0] ?? {})).not.toContain('cancelled_at');
  });

  it('si no ha cambiado nada, NO escribe: cuenta «ya estaba»', async () => {
    const { db, inserciones, parches } = cliente({ eventos: [FILA_J1_EN_LA_BASE] });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.yaEstaban).toBe(1);
    expect(r.actualizados).toEqual([]);
    expect(inserciones).toHaveLength(0);
    expect(parches).toHaveLength(0);
  });

  it('un update que falla no se come el equipo: va a omitidos y sigue', async () => {
    const { db } = cliente({
      eventos: [{ ...FILA_J1_EN_LA_BASE, starts_at: '2026-10-17T08:30:00+00:00' }],
      errorUpdate: { message: 'violates check constraint' },
    });
    const r = await importarCalendarioDeEquipoFromClient(db, EQUIPO, {
      actorProfileId: ACTOR,
      cfg: { ...CFG, fetchImpl: apiConJornadas({ '1': [J1] }) },
    });
    expect(r.actualizados).toEqual([]);
    expect(r.omitidos).toEqual([{ acta: '26539172', motivo: 'violates check constraint' }]);
    expect(r.fallo).toBeNull();
  });
});

describe('veredictoDeEquipo · un fallo con HTTP 200 no se pinta como hecho', () => {
  const FALLO = {
    motivo: 'api',
    detalle: 'el equipo 15146 no aparece en ninguna jornada',
  } as const;

  it('EL AGUJERO DEL 2026-10-13: ok:true con resumen.fallo es ROTO, no hecho', () => {
    // Alevín C y Benjamín A llegaron exactamente así: 200, ok:true, contadores a cero y
    // un fallo dentro. La pantalla los enseñó como «0 nuevos, 0 ya estaban».
    const v = veredictoDeEquipo(true, {
      ok: true,
      resumen: { fallo: FALLO, leidos: 0, creados: 0, yaEstaban: 0 },
    });
    expect(v.ok).toBe(false);
    expect(v).toEqual({ ok: false, fallo: FALLO });
  });

  it('sin fallo devuelve el resumen, ya estrechado', () => {
    const resumen = { fallo: null, leidos: 26, creados: 0, yaEstaban: 26 };
    const v = veredictoDeEquipo(true, { ok: true, resumen });
    expect(v).toEqual({ ok: true, resumen });
  });

  it('un HTTP malo va por la clave de error de la ruta', () => {
    expect(veredictoDeEquipo(false, { error: 'prohibido' })).toEqual({
      ok: false,
      clave: 'prohibido',
    });
  });

  it('ok:false, o un sobre sin resumen, caen en la clave genérica', () => {
    expect(veredictoDeEquipo(true, { ok: false })).toEqual({ ok: false, clave: 'ffcv' });
    expect(veredictoDeEquipo(true, { ok: true })).toEqual({ ok: false, clave: 'ffcv' });
    expect(veredictoDeEquipo(true, { ok: true, resumen: null })).toEqual({
      ok: false,
      clave: 'ffcv',
    });
  });
});

describe('veredictoDeRespuesta · un cuerpo que no es JSON no es un problema de red', () => {
  /**
   * El 2026-10-13, los cinco últimos equipos de la serie salieron con «No se ha podido
   * conectar». No era la red: Vercel había matado la invocación a los 300 s y devuelto
   * su página de error en HTML, y el `res.json()` del diálogo lanzaba dentro del mismo
   * `catch` que la caída de red. El mensaje acusaba a la conexión de Jose.
   */
  it('EL CASO MEDIDO: la página de timeout de Vercel es «servidor», no «red»', () => {
    const v = veredictoDeRespuesta(504, '<!DOCTYPE html><title>504: GATEWAY_TIMEOUT</title>');
    expect(v).toEqual({ ok: false, clave: 'servidor', status: 504 });
  });

  it('un 200 con cuerpo que no es JSON también, y lleva su estado', () => {
    expect(veredictoDeRespuesta(200, 'no soy json')).toEqual({
      ok: false,
      clave: 'servidor',
      status: 200,
    });
  });

  it('un JSON bueno con fallo dentro sigue siendo el fallo, no «servidor»', () => {
    const fallo = { motivo: 'degradado', intentos: 8, detalle: 'HTTP 503' } as const;
    const v = veredictoDeRespuesta(200, JSON.stringify({ ok: true, resumen: { fallo } }));
    expect(v).toEqual({ ok: false, fallo });
  });

  it('y un JSON bueno sin fallo devuelve el resumen', () => {
    const resumen = { fallo: null, leidos: 26, creados: 0, yaEstaban: 26 };
    expect(veredictoDeRespuesta(200, JSON.stringify({ ok: true, resumen }))).toEqual({
      ok: true,
      resumen,
    });
  });

  it('un error con su clave la conserva: el 403 no se convierte en «servidor»', () => {
    expect(veredictoDeRespuesta(403, JSON.stringify({ error: 'forbidden' }))).toEqual({
      ok: false,
      clave: 'forbidden',
    });
  });

  it('un cuerpo que es JSON pero no un objeto no cuela', () => {
    expect(veredictoDeRespuesta(200, 'null')).toEqual({
      ok: false,
      clave: 'servidor',
      status: 200,
    });
    expect(veredictoDeRespuesta(200, '"hola"')).toEqual({
      ok: false,
      clave: 'servidor',
      status: 200,
    });
  });
});
