import { describe, expect, it } from 'vitest';
import {
  FFCV_ESPERA_429_MS,
  FFCV_TIEMPO_MAX_MS,
  FFCV_ESPERA_MAX_MS,
  FFCV_INTENTOS,
  FFCV_POR_MINUTO,
  FFCV_VENTANA_MS,
  crearMarcapasos,
  describirFallo,
  esperaDeIntento,
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

function fingir(pasos: Paso[]): {
  fetchImpl: FfcvFetch;
  llamadas: string[];
  cabeceras: Record<string, string>[];
} {
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
    const r = await pedirJson<{ jornadas: unknown[] }>(
      'api/filtros/jornadas_fetch.php?cod_grupo=1',
      {
        ...CFG_BASE,
        fetchImpl,
      },
    );
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
    const { fetchImpl } = fingir([
      { status: 200, body: { estado: '1', jornada: '7', partidos: [] } },
    ]);
    const r = await pedirJson<{ jornada: string }>(
      'api/partidos/x.php?cod_jornada=1',
      {
        ...CFG_BASE,
        fetchImpl,
      },
      (d) => (d.jornada === '1' ? null : `se pidio la 1 y vino la ${d.jornada}`),
    );
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
    // Las dos esperas de degradación son la ESCALERA (3 s y luego 6 s), no 3 s y 3 s:
    // la paciencia de 9 s que había antes se demostró corta contra la API de verdad.
    expect(esperas).toEqual([FFCV_ESPERA_429_MS, 3_000, 6_000]);
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

// ════════════════════════════════════════════════════════════════════════════════════
// LA PACIENCIA ANTE EL ORIGEN CAÍDO (trampa 3, segunda vuelta). Los 9 s que había se
// demostraron cortos CONTRA LA API DE VERDAD: una ventana de 503 se llevó seis equipos
// de quince en el barrido de #768.
// ════════════════════════════════════════════════════════════════════════════════════

/** Reloj que avanza con las esperas, para poder medir el vencimiento sin dormir. */
function relojFalso(inicio = 1_000_000) {
  let t = inicio;
  const esperas: number[] = [];
  return {
    ahora: () => t,
    esperar: async (ms: number) => {
      esperas.push(ms);
      t += ms;
    },
    esperas,
  };
}

describe('esperaDeIntento', () => {
  it('es una escalera con techo: 3, 6, 12, 20, 20…', () => {
    expect([1, 2, 3, 4, 5, 6].map((i) => esperaDeIntento(i))).toEqual([
      3_000, 6_000, 12_000, 20_000, 20_000, 20_000,
    ]);
  });

  it('con los 8 intentos por defecto suma ~101 s de paciencia', () => {
    const total = [1, 2, 3, 4, 5, 6, 7].reduce((n, i) => n + esperaDeIntento(i), 0);
    expect(total).toBe(101_000);
    expect(FFCV_INTENTOS).toBe(8);
  });

  it('nunca pasa del techo, por alto que sea el intento', () => {
    expect(esperaDeIntento(40)).toBe(FFCV_ESPERA_MAX_MS);
  });
});

describe('pedirJson · el 503 largo', () => {
  it('EL CASO MEDIDO: cuatro cortes seguidos y la quinta buena — antes se rendía', async () => {
    // Con los 4 intentos de 3 s de antes, esto moría con la respuesta buena detrás.
    const f = fingir([
      { status: 503, texto: '<html>503</html>' },
      { status: 503, texto: '<html>503</html>' },
      { status: 503, texto: '<html>503</html>' },
      { status: 503, texto: '<html>503</html>' },
      { status: 200, body: BUENO },
    ]);
    const { esperar, esperas } = conEsperas();
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(f.llamadas).toHaveLength(5);
    expect(esperas).toEqual([3_000, 6_000, 12_000, 20_000]);
  });

  it('el 200 degradado —el disfraz— sube por la MISMA escalera', async () => {
    const f = fingir([
      { status: 200, body: DEGRADADO_VACIO_200 },
      { status: 200, body: DEGRADADO_VACIO_200 },
      { status: 200, body: BUENO },
    ]);
    const { esperar, esperas } = conEsperas();
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(esperas).toEqual([3_000, 6_000]);
  });

  it('se rinde tras los ocho intentos y lo dice', async () => {
    const f = fingir([{ status: 503, texto: 'x' }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: async () => {},
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('degradado');
    expect(f.llamadas).toHaveLength(FFCV_INTENTOS);
  });
});

describe('pedirJson · el vencimiento', () => {
  it('EL FRENO QUE SALVA AL BOTÓN: se rinde a tiempo en vez de que Vercel lo mate', async () => {
    // 10 s de margen: caben la espera de 3 s y la de 6 s, la de 12 s ya no.
    const reloj = relojFalso();
    const f = fingir([{ status: 503, texto: 'x' }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() + 10_000,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({
      motivo: 'agotado',
      esperadoMs: 9_000,
      detalle: 'HTTP 503 con cuerpo no JSON',
    });
    // Y NO ha gastado los ocho intentos: tres llamadas y fuera.
    expect(f.llamadas).toHaveLength(3);
    expect(reloj.esperas).toEqual([3_000, 6_000]);
    expect(describirFallo(r.fallo)).toContain('9s');
  });

  it('mira el vencimiento ANTES de dormir, no después', async () => {
    // Sin margen para la primera espera: no debe dormir ni una vez.
    const reloj = relojFalso();
    const f = fingir([{ status: 503, texto: 'x' }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() + 1_000,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('agotado');
    expect(reloj.esperas).toEqual([]);
    expect(f.llamadas).toHaveLength(1);
  });

  it('también frena las esperas del 429, que son las más largas', async () => {
    const reloj = relojFalso();
    const f = fingir([{ status: 429, body: LIMITADO }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() + 5_000,
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({ motivo: 'agotado', esperadoMs: 0, detalle: 'HTTP 429' });
    expect(reloj.esperas).toEqual([]);
  });

  it('sin vencimiento, la paciencia es la de siempre', async () => {
    const f = fingir([
      { status: 503, texto: 'x' },
      { status: 200, body: BUENO },
    ]);
    const r = await pedirJson<typeof BUENO>('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: async () => {},
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(true);
  });
});

describe('pedirJson · el tiempo que se gasta SIN dormir', () => {
  /**
   * El agujero del 2026-10-13. El vencimiento solo se miraba antes de dormir, así que
   * una tanda de llamadas LENTAS PERO CON ÉXITO no lo consultaba nunca y la invocación
   * de Vercel moría a los 300 s devolviendo HTML. En la pantalla salió como «no se ha
   * podido conectar» en los cinco últimos equipos de la serie.
   */
  it('EL CASO MEDIDO: no empieza una llamada después de la hora', async () => {
    const reloj = relojFalso();
    const f = fingir([{ status: 200, body: BUENO }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() - 1, // la hora ya pasó
      marcapasos: SIN_RITMO,
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('agotado');
    // Lo que importa: NI UNA llamada. Antes habría hecho la treintena entera.
    expect(f.llamadas).toEqual([]);
  });

  it('con la hora pasada no pide NI TURNO: esperar turno puede costar un minuto', async () => {
    // Son dos frenos, no uno: el de después de pedir turno no sirve si el marcapasos ya
    // se ha comido el tiempo esperando. Este test es el que los distingue.
    const reloj = relojFalso();
    let turnos = 0;
    const f = fingir([{ status: 200, body: BUENO }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() - 1,
      marcapasos: {
        pedirTurno: async () => {
          turnos += 1;
        },
      },
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    expect(turnos).toBe(0);
    expect(f.llamadas).toEqual([]);
  });

  it('y si el TURNO se come el tiempo, tampoco llama: el freno va también después', async () => {
    // El caso patológico del marcapasos: la ventana entera esperando turno. Queda media
    // hora de nada cuando por fin toca, y sin el segundo freno se llamaría igual.
    const reloj = relojFalso();
    const f = fingir([{ status: 200, body: BUENO }]);
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() + 10_000,
      marcapasos: {
        pedirTurno: async () => {
          await reloj.esperar(FFCV_VENTANA_MS);
        },
      },
      fetchImpl: f.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.motivo).toBe('agotado');
    expect(f.llamadas).toEqual([]);
  });

  it('una llamada lenta con éxito gasta el presupuesto y la siguiente ya no sale', async () => {
    // Cada llamada tarda 20 s y NINGUNA falla: no hay reintentos, luego no hay esperas,
    // luego el freno viejo (que solo miraba al dormir) no se enteraba jamás.
    const reloj = relojFalso();
    let llamadas = 0;
    const fetchImpl: FfcvFetch = async () => {
      llamadas += 1;
      reloj.esperar(20_000); // el tiempo se va DENTRO del fetch, no durmiendo
      return new Response(JSON.stringify(BUENO), { status: 200 });
    };
    const cfg = {
      token: 'a'.repeat(64),
      esperar: reloj.esperar,
      ahora: reloj.ahora,
      vencimientoMs: reloj.ahora() + 50_000,
      marcapasos: SIN_RITMO,
      fetchImpl,
    };
    const ruta = 'api/filtros/jornadas_fetch.php?cod_grupo=905432005';
    // Tres llamadas caben en 50 s; la cuarta ya empieza pasada la hora.
    for (let i = 0; i < 3; i += 1) expect((await pedirJson(ruta, cfg)).ok).toBe(true);
    const cuarta = await pedirJson(ruta, cfg);
    expect(cuarta.ok).toBe(false);
    if (cuarta.ok) return;
    expect(cuarta.fallo.motivo).toBe('agotado');
    expect(llamadas).toBe(3);
  });
});

describe('pedirJson · el corte por tiempo de UNA llamada', () => {
  /** Un fetch que no contesta nunca y solo termina si lo abortan. */
  const colgado = (): { fetchImpl: FfcvFetch; abortos: number } => {
    const estado = { abortos: 0 };
    const fetchImpl: FfcvFetch = (_url, init) =>
      new Promise((_resolver, rechazar) => {
        init?.signal?.addEventListener('abort', () => {
          estado.abortos += 1;
          rechazar(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    return {
      fetchImpl,
      get abortos() {
        return estado.abortos;
      },
    };
  };

  it('EL AGUJERO: una conexión colgada ya no se come la invocación entera', async () => {
    const c = colgado();
    const r = await pedirJson('api/filtros/jornadas_fetch.php?cod_grupo=905432005', {
      token: 'a'.repeat(64),
      esperar: async () => {},
      intentos: 2,
      tiempoMaxMs: 20,
      marcapasos: SIN_RITMO,
      fetchImpl: c.fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({
      motivo: 'degradado',
      intentos: 2,
      detalle: 'sin respuesta en 20 ms',
    });
    // Y se ha reintentado: una llamada colgada es el origen sin contestar, como un 503.
    expect(c.abortos).toBe(2);
  });

  it('el token tampoco se queda colgado: es la PRIMERA llamada del viaje', async () => {
    const c = colgado();
    const r = await leerToken({ tiempoMaxMs: 20, marcapasos: SIN_RITMO, fetchImpl: c.fetchImpl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo).toEqual({ motivo: 'sin_token', detalle: 'sin respuesta en 20 ms' });
  });

  it('el techo por defecto son 20 s: 2,7 veces la peor llamada medida (7,5 s)', () => {
    expect(FFCV_TIEMPO_MAX_MS).toBe(20_000);
  });
});
