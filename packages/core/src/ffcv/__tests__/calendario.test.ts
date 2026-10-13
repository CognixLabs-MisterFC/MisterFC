import { describe, expect, it } from 'vitest';
import {
  leerCalendarioDeEquipo,
  leerFichaEquipo,
  leerPartidosDeJornada,
  limpiarNombreEquipo,
  mapearPartido,
  resolverUbicacion,
} from '../calendario';
import { describirFallo } from '../client';
import type { FfcvFetch, PartidoCrudo } from '../types';

/**
 * Payloads LITERALES de producción, leídos el 2026-10-12. El primero es la jornada 1 real
 * del Infantil B (codequipo 15140) y el segundo un partido YA JUGADO de la Lliga
 * Autonòmica Infantil, que es de donde sale la forma de `estado: '1'`.
 */
const PARTIDO_FUERA: PartidoCrudo = {
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
const PARTIDO_JUGADO: PartidoCrudo = {
  campo: 'Ciudad Dptva. del Levante U.D. F-11 Campo 4',
  cod_equipo_local: '14316',
  cod_equipo_visitante: '14887',
  codacta: '26478932',
  estado: '1',
  fecha: '05/09/2026',
  hora: '11:00',
  local: "Levante U.D. 'A'",
  visitante: "C.F. Inter San José Valencia 'A'",
};

const CFG = { token: 'a'.repeat(64), esperar: async () => {}, intentos: 2 };

/** Doble de `fetch` que enruta por subcadena de la URL. */
function router(rutas: { contiene: string; body: unknown; status?: number }[]): {
  fetchImpl: FfcvFetch;
  llamadas: string[];
} {
  const llamadas: string[] = [];
  const fetchImpl: FfcvFetch = async (url) => {
    llamadas.push(url);
    const r = rutas.find((x) => url.includes(x.contiene));
    if (!r) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { fetchImpl, llamadas };
}

describe('limpiarNombreEquipo', () => {
  it('quita las comillas de la FFCV y nada más (decisión de Jose: verbatim)', () => {
    expect(limpiarNombreEquipo("U.D. Fonteta 'B'")).toBe('U.D. Fonteta B');
    expect(limpiarNombreEquipo("C.D. Jesuitas Valencia-S. Fútbol 'E'")).toBe(
      'C.D. Jesuitas Valencia-S. Fútbol E',
    );
    expect(limpiarNombreEquipo("Deutsche Schule Valencia F.C. 'B'")).toBe(
      'Deutsche Schule Valencia F.C. B',
    );
  });
});

describe('mapearPartido', () => {
  it('visto desde el visitante: fuera de casa, rival el local, hora ya en UTC', () => {
    expect(mapearPartido(PARTIDO_FUERA, 1, '15140')).toEqual({
      acta: '26539172',
      jornada: 1,
      fechaHoraIso: '2026-10-18T08:30:00.000Z',
      enCasa: false,
      rival: 'C.D. At. Nazaret C',
      codigoRival: '906821360',
      campo: 'Polideportivo Mpal. de Nazaret F-11',
      jugado: false,
      horaDeRelleno: false,
    });
  });

  it('visto desde el local: en casa, y `estado: 1` es jugado', () => {
    const p = mapearPartido(PARTIDO_JUGADO, 1, '14316');
    expect(p?.enCasa).toBe(true);
    expect(p?.rival).toBe('C.F. Inter San José Valencia A');
    expect(p?.jugado).toBe(true);
  });

  it('un partido que no es nuestro no se mapea', () => {
    expect(mapearPartido(PARTIDO_FUERA, 1, '99999')).toBeNull();
  });

  it('sin acta o con fecha ilegible no se mapea a medias', () => {
    expect(mapearPartido({ ...PARTIDO_FUERA, codacta: '' }, 1, '15140')).toBeNull();
    expect(mapearPartido({ ...PARTIDO_FUERA, fecha: '' }, 1, '15140')).toBeNull();
  });
});

describe('leerPartidosDeJornada', () => {
  it('caza el filtro ignorado por el ECO de la jornada', async () => {
    const { fetchImpl } = router([
      {
        contiene: 'resultados_por_grupo_jornada_data',
        body: { estado: '1', jornada: '4', partidos: [] },
      },
    ]);
    const r = await leerPartidosDeJornada(
      { temporada: '22', competicion: '905431987', grupo: '905432005', jornada: '1' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('filtro_ignorado');
  });
});

describe('leerFichaEquipo', () => {
  it('caza una ficha que no es la pedida', async () => {
    const { fetchImpl } = router([
      { contiene: 'ver_equipo', body: { estado: '1', codigo_equipo: '15139' } },
    ]);
    const r = await leerFichaEquipo('15140', { ...CFG, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('filtro_ignorado');
  });
});

describe('leerCalendarioDeEquipo', () => {
  const JORNADAS = {
    estado: '1',
    jornadas: [
      { codjornada: '1', fecha_jornada: '18-10-2026' },
      { codjornada: '2', fecha_jornada: '25-10-2026' },
    ],
  };

  it('junta los partidos nuestros y cuenta las jornadas leídas (se puede descansar)', async () => {
    let i = 0;
    const fetchImpl: FfcvFetch = async (url) => {
      if (url.includes('jornadas_fetch'))
        return new Response(JSON.stringify(JORNADAS), { status: 200 });
      i += 1;
      // En la jornada 1 jugamos; en la 2 no aparecemos.
      const body =
        i === 1
          ? { estado: '1', jornada: '1', partidos: [PARTIDO_FUERA] }
          : { estado: '1', jornada: '2', partidos: [PARTIDO_JUGADO] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.jornadasLeidas).toBe(2);
    expect(r.datos.partidos.map((p) => p.acta)).toEqual(['26539172']);
  });

  it('FALLA CERRADO: si una jornada se degrada, no devuelve un calendario incompleto', async () => {
    const fetchImpl: FfcvFetch = async (url) => {
      if (url.includes('jornadas_fetch'))
        return new Response(JSON.stringify(JORNADAS), { status: 200 });
      const body = url.includes('cod_jornada=1')
        ? { estado: '1', jornada: '1', partidos: [PARTIDO_FUERA] }
        : { partidos: [], _source: 'degraded_empty', _upstream: { code: 503 } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    // Si esto devolviera { ok: true } con 1 partido, el partido que falta no se veria.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('degradado');
  });

  /**
   * OJO AL CAMBIO (2026-10-13): este test se llamaba «fecha ilegible» pero su fixture era
   * `hora: ''` — el nombre y lo que medía no coincidían, y lo que medía (la hora vacía)
   * ahora es LEGAL por decisión de Jose. Se parte en dos: la fecha ilegible sigue siendo
   * fallo, y la hora vacía entra con relleno.
   */
  function conUnPartido(partido: PartidoCrudo): FfcvFetch {
    return async (url) => {
      if (url.includes('jornadas_fetch')) {
        return new Response(JSON.stringify({ estado: '1', jornadas: [{ codjornada: '1' }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ estado: '1', jornada: '1', partidos: [partido] }), {
        status: 200,
      });
    };
  }

  it('un partido NUESTRO con la FECHA ilegible es un fallo, no un partido que se salta', async () => {
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl: conUnPartido({ ...PARTIDO_FUERA, fecha: 'el sabado' }) },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('api');
  });

  it('un partido NUESTRO sin HORA entra, con relleno: ya no tumba el calendario', async () => {
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl: conUnPartido({ ...PARTIDO_FUERA, hora: '' }) },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.partidos).toHaveLength(1);
    expect(r.datos.partidos[0]?.horaDeRelleno).toBe(true);
  });

  it('un grupo sin jornadas se trata como fallo: no es un estado real', async () => {
    const { fetchImpl } = router([
      { contiene: 'jornadas_fetch', body: { estado: '1', jornadas: [] } },
    ]);
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('filtro_ignorado');
  });
});

describe('resolverUbicacion', () => {
  /** Las TRES competiciones que comparten la categoría 7818, como en producción. */
  const COMPETICIONES = {
    estado: '1',
    competiciones: [
      { codigo: '905432012', nombre: 'Segona Infantil Alacant', CodigoCategoria: '7818' },
      { codigo: '905431645', nombre: 'Segona Infantil Castelló', CodigoCategoria: '7818' },
      { codigo: '905431987', nombre: 'Segona Infantil València', CodigoCategoria: '7818' },
      { codigo: '905431905', nombre: 'Lliga Autonòmica Infantil', CodigoCategoria: '7817' },
    ],
  };

  it('barre las competiciones de su categoría y sus grupos hasta encontrarlo', async () => {
    const llamadas: string[] = [];
    const fetchImpl: FfcvFetch = async (url) => {
      llamadas.push(url);
      let body: unknown = {};
      if (url.includes('ver_equipo')) {
        body = { estado: '1', codigo_equipo: '15140', codigo_categoria: '7818' };
      } else if (url.includes('competiciones_fetch')) {
        body = COMPETICIONES;
      } else if (url.includes('grupos_fetch')) {
        body = {
          estado: '1',
          grupos: [
            { codigo: 'g1', nombre: 'Grup - 1' },
            { codigo: '905432005', nombre: 'Grup - 12' },
          ],
        };
      } else if (url.includes('clasificaciones_ajax')) {
        const grupo = url.includes('cod_grupo=905432005') ? '905432005' : 'g1';
        const esElNuestro = grupo === '905432005' && url.includes('905432005');
        body = {
          estado: '1',
          codigo_grupo: grupo,
          competicion: 'Segona Infantil València',
          grupo: grupo === '905432005' ? 'Grup - 12' : 'Grup - 1',
          clasificacion: esElNuestro
            ? [{ codequipo: '21848340' }, { codequipo: '15140' }]
            : [{ codequipo: '11111' }],
        };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await resolverUbicacion(
      { temporada: '22', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toMatchObject({
      temporada: '22',
      competicion: '905432012',
      grupo: '905432005',
      nombreGrupo: 'Grup - 12',
    });
    // Solo ha mirado las competiciones de SU categoría, no las cuatro.
    expect(llamadas.filter((u) => u.includes('grupos_fetch'))).toHaveLength(1);
  });

  it('si no está en ningún grupo, lo dice en vez de devolver un grupo cualquiera', async () => {
    const fetchImpl: FfcvFetch = async (url) => {
      let body: unknown = {};
      if (url.includes('ver_equipo'))
        body = { estado: '1', codigo_equipo: '15140', codigo_categoria: '7818' };
      else if (url.includes('competiciones_fetch')) body = COMPETICIONES;
      else if (url.includes('grupos_fetch')) body = { estado: '1', grupos: [{ codigo: 'g1' }] };
      else if (url.includes('clasificaciones_ajax')) {
        body = { estado: '1', codigo_grupo: 'g1', clasificacion: [{ codequipo: '11111' }] };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const r = await resolverUbicacion(
      { temporada: '22', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('api');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// LA HORA QUE LA FFCV NO HA PUESTO, Y EL CALENDARIO VACÍO. Las dos salieron del alta
// real del 2026-10-12: dos equipos perdidos por una hora sin poner, y dos equipos que
// salieron «0 y 0» en el botón teniendo 30 y 26 partidos creados.
// ════════════════════════════════════════════════════════════════════════════════════

/** El partido REAL del Alevín C que tumbaba su calendario: fecha sí, hora VACÍA. */
const PARTIDO_SIN_HORA: PartidoCrudo = {
  campo: 'Camp Mpal. de Benimaclet F-8',
  cod_equipo_local: '905505267',
  cod_equipo_visitante: '900100100',
  codacta: '26566704',
  estado: '0',
  fecha: '18/10/2026',
  hora: '',
  local: "U.D. Fonteta 'C'",
  visitante: "C.F. Benimaclet 'B'",
};

describe('mapearPartido · la hora de relleno', () => {
  it('EL CASO MEDIDO: sin hora entra con las 9:00 y marcado como relleno', async () => {
    const p = mapearPartido(PARTIDO_SIN_HORA, 1, '905505267');
    expect(p).not.toBeNull();
    expect(p?.horaDeRelleno).toBe(true);
    // 9:00 de Madrid el 18-10-2026 (CEST, UTC+2) son las 07:00 UTC.
    expect(p?.fechaHoraIso).toBe('2026-10-18T07:00:00.000Z');
  });

  it('con hora de verdad, NO marca relleno', () => {
    const p = mapearPartido(PARTIDO_FUERA, 1, '15140');
    expect(p?.horaDeRelleno).toBe(false);
    expect(p?.fechaHoraIso).toBe('2026-10-18T08:30:00.000Z');
  });

  it('una FECHA ilegible sigue siendo null: el día no se rellena', () => {
    // Rellenar la hora es acotado; inventarse el día pondría el partido en otra semana.
    expect(mapearPartido({ ...PARTIDO_SIN_HORA, fecha: '' }, 1, '905505267')).toBeNull();
    expect(mapearPartido({ ...PARTIDO_SIN_HORA, fecha: 'el sabado' }, 1, '905505267')).toBeNull();
  });
});

describe('leerCalendarioDeEquipo · cero partidos', () => {
  it('EL CASO MEDIDO: no aparecer en ninguna jornada es FALLO, no un calendario vacío', async () => {
    // Cadete A e Infantil A salieron «0 nuevos, 0 ya estaban» con 30 y 26 creados: un
    // vacío disfrazado de éxito, indistinguible de «todo al día».
    const fetchImpl: FfcvFetch = async (url) => {
      if (url.includes('jornadas_fetch')) {
        return new Response(
          JSON.stringify({ estado: '1', jornadas: [{ codjornada: '1' }, { codjornada: '2' }] }),
          { status: 200 },
        );
      }
      // Payload LIMPIO y vacío de los nuestros: sin marca de degradación, nada lo caza.
      // El eco de la jornada tiene que ser el pedido, o salta `filtro_ignorado` antes.
      const j = /cod_jornada=(\d+)/.exec(url)?.[1] ?? '1';
      return new Response(JSON.stringify({ estado: '1', jornada: j, partidos: [PARTIDO_JUGADO] }), {
        status: 200,
      });
    };
    const r = await leerCalendarioDeEquipo(
      { temporada: '22', competicion: '905431987', grupo: '905432005', codigoEquipo: '15140' },
      { ...CFG, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('api');
    expect(describirFallo(r.fallo)).toContain('no aparece en ninguna');
  });
});
