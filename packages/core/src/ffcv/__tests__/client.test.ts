import { describe, expect, it } from 'vitest';
import {
  describirFallo,
  leerToken,
  motivoDeDegradacion,
  motivoDeRechazo,
  pedirJson,
} from '../client';
import type { FfcvFetch } from '../types';

/**
 * Los payloads de aquí son LITERALES de producción, copiados de las respuestas medidas el
 * 2026-10-12. No están inventados ni "simplificados": un fixture con claves de mentira da
 * un verde que no mide nada, y toda la defensa de F-3 depende de reconocer exactamente
 * estas formas.
 */
const DEGRADADO_CODE_API = {
  estado: '0',
  error: 'Respuesta vacía desde NSMApi_Equipos',
  code_api: 503,
  url: 'https://appwebffcv.novanet.es/pnfg/NPcd/NSMApi_Equipos?codgrupo=905431988&NPcd_PageLines=200&NPcd_Page=1',
};
const DEGRADADO_RAW = {
  estado: '0',
  error: 'Respuesta no JSON de Equipos',
  raw: 'Error: upstream temporalmente degradado. Reintenta en unos segundos.',
};
const DEGRADADO_VACIO_200 = {
  jornadas: [],
  _source: 'degraded_empty',
  _upstream: { code: 503, message: '' },
};
const BUENO = {
  estado: '1',
  sesion_ok: '1',
  jornadas: [{ codjornada: '1', nombre: '1', fecha_jornada: '18-10-2026' }],
};
/** `estado: '0'` SIN marcas de degradación: la API diciendo que no. También es literal. */
const RECHAZO = {
  estado: '0',
  error: 'Se requiere cod_grupo/cod_competicion o Sch_Clave_Acceso_Club',
};

type Paso = { status?: number; body?: unknown; texto?: string };

function fingir(pasos: Paso[]): { fetchImpl: FfcvFetch; llamadas: string[]; cabeceras: Record<string, string>[] } {
  const llamadas: string[] = [];
  const cabeceras: Record<string, string>[] = [];
  let i = 0;
  const fetchImpl: FfcvFetch = async (url, init) => {
    llamadas.push(url);
    if (init?.headers) cabeceras.push(init.headers as Record<string, string>);
    const paso = pasos[Math.min(i, pasos.length - 1)] ?? {};
    i += 1;
    const cuerpo = paso.texto ?? JSON.stringify(paso.body ?? {});
    return new Response(cuerpo, { status: paso.status ?? 200 });
  };
  return { fetchImpl, llamadas, cabeceras };
}

const CFG_BASE = { token: 'a'.repeat(64), esperar: async () => {}, intentos: 3 };

describe('motivoDeDegradacion · reconoce al origen caído en sus cuatro disfraces', () => {
  it('lo caza por code_api', () => {
    expect(motivoDeDegradacion(DEGRADADO_CODE_API)).toBe('code_api=503');
  });

  it('lo caza por el texto de raw', () => {
    expect(motivoDeDegradacion(DEGRADADO_RAW)).toContain('degradad');
  });

  it('lo caza por _source, que es el que viene con HTTP 200', () => {
    expect(motivoDeDegradacion(DEGRADADO_VACIO_200)).toBe('_source=degraded_empty');
  });

  it('NO confunde un payload bueno con una degradación', () => {
    expect(motivoDeDegradacion(BUENO)).toBeNull();
  });

  it('NO confunde un «no» de la API con una degradación', () => {
    // Si esto fallara, un error de parámetros se reintentaría cuatro veces y se
    // reportaría como «origen degradado», que es un diagnóstico falso.
    expect(motivoDeDegradacion(RECHAZO)).toBeNull();
    expect(motivoDeRechazo(RECHAZO)).toBe(
      'Se requiere cod_grupo/cod_competicion o Sch_Clave_Acceso_Club',
    );
    expect(motivoDeRechazo(BUENO)).toBeNull();
  });
});

describe('pedirJson', () => {
  it('EL CASO QUE JUSTIFICA F-3: un 200 con lista vacía NO es una lista vacía', async () => {
    const { fetchImpl } = fingir([{ status: 200, body: DEGRADADO_VACIO_200 }]);
    const r = await pedirJson<{ jornadas: unknown[] }>('api/filtros/jornadas_fetch.php?cod_grupo=1', {
      ...CFG_BASE,
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('degradado');
    expect(describirFallo(r.fallo)).toContain('degraded_empty');
  });

  it('reintenta la degradación y se queda con la respuesta buena', async () => {
    const { fetchImpl, llamadas } = fingir([
      { status: 503, body: DEGRADADO_CODE_API },
      { status: 200, body: DEGRADADO_VACIO_200 },
      { status: 200, body: BUENO },
    ]);
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=1', {
      ...CFG_BASE,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.jornadas).toHaveLength(1);
    expect(llamadas).toHaveLength(3);
  });

  it('se rinde tras los intentos configurados y lo dice', async () => {
    const { fetchImpl, llamadas } = fingir([{ status: 200, body: DEGRADADO_VACIO_200 }]);
    const r = await pedirJson('api/x.php', { ...CFG_BASE, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({
      motivo: 'degradado',
      intentos: 3,
      detalle: '_source=degraded_empty',
    });
    expect(llamadas).toHaveLength(3);
  });

  it('un «no» de la API no se reintenta: una sola llamada', async () => {
    const { fetchImpl, llamadas } = fingir([{ status: 200, body: RECHAZO }]);
    const r = await pedirJson('api/equipos/equipos.php', { ...CFG_BASE, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('api');
    expect(llamadas).toHaveLength(1);
  });

  it('un filtro ignorado se caza en el payload, no en el parámetro', async () => {
    const { fetchImpl } = fingir([{ status: 200, body: { estado: '1', jornada: '7', partidos: [] } }]);
    const r = await pedirJson<{ jornada: string }>('api/partidos/x.php?cod_jornada=1', {
      ...CFG_BASE,
      fetchImpl,
    }, (d) => (d.jornada === '1' ? null : `se pidio la 1 y vino la ${d.jornada}`));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('filtro_ignorado');
    expect(describirFallo(r.fallo)).toContain('vino la 7');
  });

  it('manda el token en su cabecera', async () => {
    const { fetchImpl, cabeceras } = fingir([{ status: 200, body: BUENO }]);
    await pedirJson('api/x.php', { ...CFG_BASE, fetchImpl });
    expect(cabeceras[0]).toMatchObject({ 'X-FFCV-Page-Token': 'a'.repeat(64) });
  });

  it('un 200 que no es JSON no se reintenta: es otra cosa', async () => {
    const { fetchImpl, llamadas } = fingir([{ status: 200, texto: '<!DOCTYPE html><html>' }]);
    const r = await pedirJson('api/x.php', { ...CFG_BASE, fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('no_json');
    expect(llamadas).toHaveLength(1);
  });
});

describe('leerToken', () => {
  it('lo raspa del meta de la portada', async () => {
    const html =
      '<head><meta name="ffcv-pt" content="e38a5378094dcb1d73fd7ae228e2c38bb9b55ce7a581d5838b11de8571a5cbff"><script>';
    const { fetchImpl } = fingir([{ status: 200, texto: html }]);
    const r = await leerToken({ fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toBe('e38a5378094dcb1d73fd7ae228e2c38bb9b55ce7a581d5838b11de8571a5cbff');
  });

  it('si la portada no trae el meta, lo dice en vez de seguir sin token', async () => {
    const { fetchImpl } = fingir([{ status: 200, texto: '<html><body>nada</body></html>' }]);
    const r = await leerToken({ fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('sin_token');
  });
});
