import { describe, expect, it } from 'vitest';
import {
  FFCV_ESPERA_429_MS,
  FFCV_POR_MINUTO,
  FFCV_VENTANA_MS,
  crearMarcapasos,
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

// ════════════════════════════════════════════════════════════════════════════════════
// EL LÍMITE DE RITMO (trampa 4). La FFCV corta a las 60 por minuto y la primera vez
// que mordió se perdieron 13 de 15 calendarios en cadena.
// ════════════════════════════════════════════════════════════════════════════════════

/** El 429 literal de producción, medido el 2026-10-12. */
const LIMITADO = {
  error: 'too_many_requests',
  reason: 'Rate limit excedido',
  reason_code: 'RATE_LIMIT',
  request_id: 'req_7f3a9c21',
};

function conEsperas(): { esperar: (ms: number) => Promise<void>; esperas: number[] } {
  const esperas: number[] = [];
  return {
    esperar: async (ms: number) => {
      esperas.push(ms);
    },
    esperas,
  };
}

/** Un marcapasos que no estorba, para los tests que no van de eso. */
const SIN_RITMO = crearMarcapasos(Number.POSITIVE_INFINITY);

describe('pedirJson · el 429', () => {
  it('lo espera y lo reintenta, en vez de devolverlo como fallo', async () => {
    const f = fingir([
      { status: 429, body: LIMITADO },
      { status: 200, body: BUENO },
    ]);
    const { esperar, esperas } = conEsperas();
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      ...CFG_BASE,
      esperar,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(f.llamadas).toHaveLength(2);
    // La espera es la recuperación MEDIDA (30 s), no los 3 s de la degradación.
    expect(esperas).toEqual([FFCV_ESPERA_429_MS]);
  });

  it('EL FALLO EN CADENA QUE ESTO ARREGLA: no gasta los intentos de la degradación', async () => {
    // Un 429 y luego los dos 503 que la peor llamada medida necesitó. Con un presupuesto
    // compartido, el 429 se habría comido un intento y el tercer 503 habría agotado los
    // tres: la llamada moriría teniendo respuesta buena detrás.
    const f = fingir([
      { status: 429, body: LIMITADO },
      { status: 503, texto: '<html>502 Bad Gateway</html>' },
      { status: 503, texto: '<html>502 Bad Gateway</html>' },
      { status: 200, body: BUENO },
    ]);
    const { esperar, esperas } = conEsperas();
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      ...CFG_BASE,
      intentos: 3,
      esperar,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(f.llamadas).toHaveLength(4);
    expect(esperas).toEqual([FFCV_ESPERA_429_MS, 3_000, 3_000]);
  });

  it('se rinde tras las esperas configuradas, y el fallo dice que fue el ritmo', async () => {
    const f = fingir([{ status: 429, body: LIMITADO }]);
    const { esperar, esperas } = conEsperas();
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      ...CFG_BASE,
      esperar,
      marcapasos: SIN_RITMO,
      intentos429: 3,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({ motivo: 'limitado', intentos: 3 });
    expect(describirFallo(r.fallo)).toContain('429');
    expect(f.llamadas).toHaveLength(3);
    expect(esperas).toEqual([FFCV_ESPERA_429_MS, FFCV_ESPERA_429_MS]);
  });

  it('un 429 NO se confunde con un «no» de la API aunque el cuerpo sea JSON', async () => {
    // El cuerpo del 429 es JSON válido y trae `error`. Si se parseara antes de mirar el
    // estado, acabaría en `api` —que no se reintenta— y el corte sería definitivo.
    const f = fingir([
      { status: 429, body: LIMITADO },
      { status: 200, body: BUENO },
    ]);
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      ...CFG_BASE,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
  });

  it('pide turno al marcapasos en CADA intento, no solo en el primero', async () => {
    let turnos = 0;
    const espia = {
      pedirTurno: async () => {
        turnos += 1;
      },
    };
    const f = fingir([
      { status: 503, texto: 'x' },
      { status: 503, texto: 'x' },
      { status: 200, body: BUENO },
    ]);
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      ...CFG_BASE,
      intentos: 3,
      marcapasos: espia,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(turnos).toBe(3);
  });
});

describe('leerToken · el 429', () => {
  const PORTADA = '<html><meta name="ffcv-pt" content="' + 'b'.repeat(32) + '"></html>';

  it('lo aguanta: si el raspado del token cae, cae todo lo de detrás', async () => {
    const f = fingir([
      { status: 429, body: LIMITADO },
      { status: 200, texto: PORTADA },
    ]);
    const { esperar, esperas } = conEsperas();
    const r = await leerToken({ esperar, marcapasos: SIN_RITMO, fetchImpl: f.fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos).toBe('b'.repeat(32));
    expect(esperas).toEqual([FFCV_ESPERA_429_MS]);
  });

  it('si el 429 no cede, lo dice con su nombre y no como «sin_token»', async () => {
    const f = fingir([{ status: 429, body: LIMITADO }]);
    const r = await leerToken({
      esperar: async () => {},
      marcapasos: SIN_RITMO,
      intentos429: 2,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({ motivo: 'limitado', intentos: 2 });
  });
});

describe('crearMarcapasos', () => {
  it('deja pasar hasta el techo sin esperar', async () => {
    const m = crearMarcapasos(3, 1_000);
    const { esperar, esperas } = conEsperas();
    for (let i = 0; i < 3; i += 1) await m.pedirTurno(esperar, () => 0);
    expect(esperas).toEqual([]);
  });

  it('en la siguiente espera EXACTAMENTE lo que le queda a la ventana', async () => {
    const m = crearMarcapasos(3, 1_000);
    const { esperar, esperas } = conEsperas();
    let t = 0;
    const ahora = () => t;
    for (let i = 0; i < 3; i += 1) await m.pedirTurno(esperar, ahora);
    t = 100;
    await m.pedirTurno(esperar, ahora);
    expect(esperas).toEqual([900]);
  });

  it('olvida los sellos que ya salieron de la ventana', async () => {
    const m = crearMarcapasos(3, 1_000);
    const { esperar, esperas } = conEsperas();
    let t = 0;
    const ahora = () => t;
    for (let i = 0; i < 3; i += 1) await m.pedirTurno(esperar, ahora);
    t = 1_200; // la ventana entera ha pasado
    await m.pedirTurno(esperar, ahora);
    await m.pedirTurno(esperar, ahora);
    expect(esperas).toEqual([]);
  });

  it('NO SE CUELGA si el reloj no avanza: admite y deja que el 429 sea la garantía', async () => {
    // Un bucle «espera y vuelve a mirar» aquí dejaría el proceso colgado para siempre
    // cuando el reloj inyectado no avanza, y colgar es mucho peor que un 429.
    const m = crearMarcapasos(1, 1_000);
    const { esperar, esperas } = conEsperas();
    await m.pedirTurno(esperar, () => 0);
    await m.pedirTurno(esperar, () => 0);
    await m.pedirTurno(esperar, () => 0);
    expect(esperas).toEqual([1_000, 1_000]);
  });

  it('el techo por defecto deja margen bajo las 60 medidas', () => {
    expect(FFCV_POR_MINUTO).toBeLessThan(60);
    expect(FFCV_VENTANA_MS).toBe(60_000);
  });
});
