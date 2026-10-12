/**
 * F-3 · Transporte contra la API de la FFCV.
 *
 * ── LO QUE HAY AL OTRO LADO, medido el 2026-10-12 ───────────────────────────────────
 * La web vieja (`competiciones/equipos/equipo.php`) YA NO EXISTE: devuelve 302 a la
 * portada. Lo único utilizable es `ffcv.es/competiciones/api/…`, 18 endpoints, que son un
 * proxy fino sobre `appwebffcv.novanet.es/pnfg/NPcd/NSMApi_*`. Piden la cabecera
 * `X-FFCV-Page-Token`, cuyo valor está en el `<meta name="ffcv-pt">` del HTML de
 * `/competiciones/` y ROTA (hay un `api/utils/client_version.php` con un build con fecha).
 *
 * ── LAS TRES TRAMPAS, Y POR QUÉ ESTE FICHERO EXISTE ─────────────────────────────────
 * Ninguna de las tres falla de forma ruidosa, y las tres se tragarían un calendario
 * entero sin que nadie se enterase:
 *
 *  1 · EL 200 CON LISTA VACÍA. Cuando el origen está caído, el proxy responde
 *      **HTTP 200** con `{"jornadas": [], "_source": "degraded_empty", "_upstream": …}`.
 *      Un lector que mire el código de estado concluye «este grupo no tiene jornadas».
 *      Si algún día la sincronización borrara lo que no ve, se lleva el calendario por
 *      delante. Aquí eso es un ERROR, nunca una lista vacía.
 *
 *  2 · LOS FILTROS QUE ACEPTA Y NO APLICA. `cod_grupo` en `equipos.php` devolvió los
 *      7.238 equipos de toda la federación; `nombre` en `campos.php` devuelve lo mismo
 *      con filtro y sin él. O sea que un parámetro aceptado NO prueba nada. Por eso
 *      `pedirJson` admite un `verificar` que comprueba en el PAYLOAD que lo devuelto es
 *      lo pedido, aprovechando que varios endpoints hacen eco de lo que se les pidió
 *      (`jornada`, `codigo_grupo`, `codigo_competicion`, `clave_acceso_club`).
 *
 *  3 · EL ORIGEN SE CAE A RATOS. Los 503 de `NSMApi_*` aparecen y desaparecen; una misma
 *      llamada necesitó tres intentos. De ahí el reintento con espera, inyectable para
 *      que los tests no duerman.
 *
 *  4 · EL LÍMITE DE RITMO, medido el 2026-10-12 (y añadido después de que mordiera).
 *      La FFCV corta a las **60 peticiones por minuto**: la 60ª pasa y la 61ª devuelve
 *      **HTTP 429** con `{"error":"too_many_requests","reason":"Rate limit excedido",
 *      "reason_code":"RATE_LIMIT"}`. No es un límite por ruta —40 seguidas a la misma
 *      ruta pasan sin un corte—, lo que corta es el VOLUMEN total. Se recupera entre los
 *      15 s y los 30 s y **no manda `Retry-After`** ni cabeceras de cuota, así que no hay
 *      nada que leer: hay que medirlo y respetarlo a ciegas.
 *
 *      Esto se descubrió barriendo los grupos de los 15 equipos (#768): la primera
 *      pasada resolvió DOS equipos y perdió los TRECE restantes en cadena, porque un 429
 *      salía por la puerta de `!res.ok` —sin espera y sin reintento— y el siguiente
 *      equipo se encontraba la ventana igual de cerrada. Un fallo en cadena es lo peor
 *      que le puede pasar a esto: trece calendarios perdidos por un corte de un minuto.
 *
 *      La defensa son DOS piezas, y hacen falta las dos:
 *        · el MARCAPASOS, que no deja pasar del techo y evita el 429 (a 1,1 s por
 *          llamada se midieron 397 llamadas con CERO cortes);
 *        · el REINTENTO del 429, que es la garantía cuando el marcapasos no basta —otro
 *          proceso consumiendo la misma cuota, o la misma IP compartida—. Su espera es
 *          la recuperación medida, no los 3 s de la degradación.
 *
 * ── UN ESTADO QUE NO ES DEGRADACIÓN ─────────────────────────────────────────────────
 * El proxy marca sus respuestas con `estado`: '1' bien, '0' mal. Un '0' SIN marcas de
 * degradación (ni `code_api`, ni `_upstream`, ni la palabra «degradado») no es el origen
 * cayéndose: es la API diciendo que no. Se distingue a propósito, porque reintentar
 * cuatro veces un «no» es ruido y porque confundirlos haría ilegible el diagnóstico.
 */

import type { FfcvFetch } from './types';

export const FFCV_BASE = 'https://ffcv.es/competiciones/';
export const FFCV_CABECERA_TOKEN = 'X-FFCV-Page-Token';
/**
 * ── LA PACIENCIA ANTE EL ORIGEN CAÍDO, Y POR QUÉ SUBIÓ ──────────────────────────────
 * Esto empezó siendo 4 intentos de 3 s —9 s de paciencia total— porque la peor llamada
 * medida con dobles necesitó tres. Contra la API DE VERDAD eso resultó ser muy poco:
 *
 *   · Barriendo los grupos de los 15 equipos (#768), una ventana de 503 se llevó SEIS
 *     equipos de quince. Los seis salieron en una segunda pasada con esperas de 20 s.
 *   · Midiendo la cobertura de direcciones, 9 s tumbaron la lectura de UN equipo del
 *     todo; con esperas de 20 s pasó sin incidencias.
 *   · En el alta de los 290 partidos, un corte en 364 llamadas, absorbido con 20 s.
 *
 * Así que la paciencia sube a ~100 s por llamada, con espera creciente y un techo: 3 s,
 * 6 s, 12 s y luego 20 s. Creciente porque un corte de un segundo no merece esperar
 * veinte, y con techo porque duplicar sin límite convierte una avería de un minuto en
 * una espera de diez.
 *
 * Lo que NO se puede afirmar, y por eso no se escribe aquí: cuánto duran esas ventanas.
 * Los logs cuentan reintentos, no distinguen si cuatro seguidos fueron de la misma
 * llamada. Los números de abajo cubren lo medido con margen, no una duración conocida.
 *
 * Y la paciencia por llamada NO puede ser la única defensa: ver `vencimientoMs`.
 */
export const FFCV_INTENTOS = 8;
export const FFCV_ESPERA_MS = 3_000;
/** El techo de la espera creciente. */
export const FFCV_ESPERA_MAX_MS = 20_000;

/**
 * La espera antes del intento siguiente: 3 s, 6 s, 12 s, 20 s, 20 s… Con
 * `FFCV_INTENTOS = 8` suman ~101 s de paciencia por llamada.
 */
export function esperaDeIntento(
  intento: number,
  base: number = FFCV_ESPERA_MS,
  techo: number = FFCV_ESPERA_MAX_MS,
): number {
  if (intento < 1) return base;
  // 2^(intento-1) crece rápido; el techo es lo que lo hace usable.
  const crecida = base * 2 ** (intento - 1);
  return Math.min(crecida, techo);
}

/**
 * El techo que se respeta. El límite medido son 60 por minuto; se deja margen a
 * propósito, porque la cuota no es solo nuestra —la misma IP la gasta cualquier otra
 * cosa que llame— y porque pasarse cuesta media ventana de espera.
 */
export const FFCV_POR_MINUTO = 50;
export const FFCV_VENTANA_MS = 60_000;
/** La recuperación medida fue de entre 15 s y 30 s. Se espera la peor. */
export const FFCV_ESPERA_429_MS = 30_000;
/** Dos esperas de 30 s cubren una ventana entera; una tercera ya no es un corte, es un muro. */
export const FFCV_INTENTOS_429 = 3;

/** Reloj inyectable: sin él, los tests del marcapasos dependerían del tiempo real. */
export type FfcvAhora = () => number;
export type FfcvEspera = (ms: number) => Promise<void>;

/**
 * El marcapasos. Reparte turnos para que no se pase del techo en una ventana.
 *
 * Es el único estado mutable de todo F-3, y es deliberado: el techo es de la FFCV, no de
 * una llamada, así que no se puede respetar sin recordar las anteriores. Por defecto se
 * comparte uno por módulo, que es lo que hace que los 15 equipos de una importación se
 * marquen el paso entre ellos y no solo cada uno por dentro.
 */
export type Marcapasos = {
  pedirTurno: (esperar: FfcvEspera, ahora: FfcvAhora) => Promise<void>;
};

export function crearMarcapasos(
  porMinuto: number = FFCV_POR_MINUTO,
  ventanaMs: number = FFCV_VENTANA_MS,
): Marcapasos {
  const sellos: number[] = [];
  // Los turnos se encolan: si dos llamadas piden a la vez, no se cuentan como una.
  let cola: Promise<void> = Promise.resolve();

  const turno = async (esperar: FfcvEspera, ahora: FfcvAhora): Promise<void> => {
    let t = ahora();
    while (sellos.length > 0 && t - sellos[0]! >= ventanaMs) sellos.shift();
    if (sellos.length >= porMinuto) {
      const falta = ventanaMs - (t - sellos[0]!);
      if (falta > 0) await esperar(falta);
      // Se descuenta el más viejo y se pasa, SIN volver a mirar el reloj en bucle: si el
      // tiempo no avanzó lo que se pidió, el reintento del 429 es la garantía. Un bucle
      // aquí colgaría el proceso, que es mucho peor que un 429 que ya sabemos aguantar.
      sellos.shift();
      t = ahora();
    }
    sellos.push(t);
  };

  return {
    pedirTurno: (esperar, ahora) => {
      const mio = cola.then(() => turno(esperar, ahora));
      cola = mio.catch(() => undefined);
      return mio;
    },
  };
}

/** El compartido. Se usa cuando `cfg.marcapasos` no dice otra cosa. */
const marcapasosCompartido = crearMarcapasos();

export type FfcvConfig = {
  base?: string;
  fetchImpl?: FfcvFetch;
  intentos?: number;
  esperaMs?: number;
  /** Inyectable para que los tests no duerman de verdad. */
  esperar?: FfcvEspera;
  /** Inyectable para que los tests del marcapasos no dependan del reloj de pared. */
  ahora?: FfcvAhora;
  /** Quien reparte los turnos. Por defecto, el compartido del módulo. */
  marcapasos?: Marcapasos;
  /** Cuántas veces se aguanta un 429 antes de rendirse. */
  intentos429?: number;
  /** Cuánto se espera tras un 429. */
  espera429Ms?: number;
  /**
   * EL FRENO DE LA PACIENCIA: instante (en ms, misma escala que `ahora()`) a partir del
   * cual ya no se espera más y se devuelve `agotado`.
   *
   * Existe por el botón. Un viaje suyo son ~29 llamadas dentro de una invocación de
   * Vercel con 300 s de techo; si cada llamada puede gastar 101 s esperando al origen,
   * dos cortes se pasan del techo y **Vercel mata la invocación**. Y una invocación
   * muerta no devuelve nada: el usuario no se enteraría de qué equipo falló ni por qué.
   * Con vencimiento, la llamada se rinde a tiempo y el viaje contesta «este equipo no se
   * pudo leer», que es lo que la barra sabe pintar.
   *
   * Sin él, la paciencia es la de `intentos`.
   */
  vencimientoMs?: number;
  /** Token ya conocido. Si falta, se raspa de la portada en la 1ª llamada. */
  token?: string;
};

export type FfcvFallo =
  | { motivo: 'sin_token'; detalle: string }
  | { motivo: 'http'; status: number }
  | { motivo: 'no_json'; detalle: string }
  | { motivo: 'degradado'; intentos: number; detalle: string }
  | { motivo: 'limitado'; intentos: number }
  | { motivo: 'agotado'; esperadoMs: number; detalle: string }
  | { motivo: 'api'; detalle: string }
  | { motivo: 'filtro_ignorado'; detalle: string };

export type FfcvResultado<T> = { ok: true; datos: T } | { ok: false; fallo: FfcvFallo };

/** Describe un fallo en una línea, para logs y para Sentry. */
export function describirFallo(f: FfcvFallo): string {
  switch (f.motivo) {
    case 'sin_token':
      return `no se pudo obtener el token de pagina: ${f.detalle}`;
    case 'http':
      return `respuesta HTTP ${f.status}`;
    case 'no_json':
      return `la respuesta no era JSON: ${f.detalle}`;
    case 'degradado':
      return `origen degradado tras ${f.intentos} intentos (${f.detalle})`;
    case 'limitado':
      return `la FFCV sigue limitando el ritmo tras ${f.intentos} esperas (HTTP 429)`;
    case 'agotado':
      return `se agoto el tiempo tras esperar ${Math.round(f.esperadoMs / 1000)}s (${f.detalle})`;
    case 'api':
      return `la API dice que no: ${f.detalle}`;
    case 'filtro_ignorado':
      return `el payload no es lo que se pidio: ${f.detalle}`;
  }
}

/**
 * ¿Es este payload el origen caído disfrazado de éxito?
 *
 * Pura y exportada a propósito: es la pieza que más importa de todo F-3 y tiene que
 * poder probarse con los payloads REALES, sin red por medio. Devuelve el motivo (para que
 * el diagnóstico diga QUÉ marca lo delató) o null si el payload es bueno.
 */
export function motivoDeDegradacion(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (p._source === 'degraded_empty') return '_source=degraded_empty';

  const up = p._upstream;
  if (up !== null && typeof up === 'object') {
    const code = (up as Record<string, unknown>).code;
    if (typeof code === 'number' && code >= 500) return `_upstream.code=${code}`;
  }

  const codeApi = p.code_api;
  if (typeof codeApi === 'number' && codeApi >= 500) return `code_api=${codeApi}`;

  for (const clave of ['raw', 'body', 'error'] as const) {
    const v = p[clave];
    if (typeof v === 'string' && /degradad/i.test(v)) return `${clave}: ${v.slice(0, 120)}`;
  }
  return null;
}

/**
 * ¿La API dice que no, sin ser degradación? (`estado === '0'` y nada más)
 * Se evalúa DESPUÉS de `motivoDeDegradacion`, porque las respuestas degradadas también
 * traen `estado: '0'` y ese caso sí hay que reintentarlo.
 */
export function motivoDeRechazo(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.estado !== '0') return null;
  const err = typeof p.error === 'string' ? p.error : '(sin texto)';
  return err;
}

function esperaPorDefecto(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Raspa el token de la portada de /competiciones/.
 *
 * Cuenta para la cuota como cualquier otra llamada, así que pide turno al marcapasos; y
 * aguanta el 429, porque si el raspado del token cae por un corte de ritmo se cae TODO
 * lo que venga detrás sin haber llegado a pedir ni un dato.
 */
export async function leerToken(cfg: FfcvConfig = {}): Promise<FfcvResultado<string>> {
  const base = cfg.base ?? FFCV_BASE;
  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as FfcvFetch);
  const esperar = cfg.esperar ?? esperaPorDefecto;
  const ahora = cfg.ahora ?? Date.now;
  const marcapasos = cfg.marcapasos ?? marcapasosCompartido;
  const intentos429 = cfg.intentos429 ?? FFCV_INTENTOS_429;
  const espera429 = cfg.espera429Ms ?? FFCV_ESPERA_429_MS;

  let res: Response;
  let limitadas = 0;
  for (;;) {
    await marcapasos.pedirTurno(esperar, ahora);
    try {
      res = await doFetch(base, { method: 'GET' });
    } catch (e) {
      return { ok: false, fallo: { motivo: 'sin_token', detalle: String(e) } };
    }
    if (res.status !== 429) break;
    limitadas += 1;
    if (limitadas >= intentos429) {
      return { ok: false, fallo: { motivo: 'limitado', intentos: limitadas } };
    }
    // El vencimiento manda también aquí: raspar el token no puede comerse el tiempo que
    // le queda al viaje, porque entonces no quedaría ninguno para leer datos.
    if (cfg.vencimientoMs !== undefined && ahora() + espera429 > cfg.vencimientoMs) {
      return {
        ok: false,
        fallo: { motivo: 'agotado', esperadoMs: limitadas * espera429, detalle: 'HTTP 429 al raspar el token' },
      };
    }
    await esperar(espera429);
  }
  if (!res.ok) {
    return { ok: false, fallo: { motivo: 'sin_token', detalle: `HTTP ${res.status}` } };
  }
  let html: string;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, fallo: { motivo: 'sin_token', detalle: String(e) } };
  }
  const m = /name=["']ffcv-pt["']\s+content=["']([a-f0-9]{16,})["']/i.exec(html);
  if (!m) {
    return {
      ok: false,
      fallo: { motivo: 'sin_token', detalle: 'no hay <meta name="ffcv-pt"> en la portada' },
    };
  }
  const token = m[1];
  if (!token) {
    return { ok: false, fallo: { motivo: 'sin_token', detalle: 'el meta ffcv-pt esta vacio' } };
  }
  return { ok: true, datos: token };
}

/**
 * Pide un endpoint de la API y devuelve su JSON, o un fallo con nombre.
 *
 * `verificar` recibe el payload ya parseado y devuelve una queja (string) si lo que llegó
 * no es lo que se pidió, o null si está bien. Es la defensa contra la trampa 2.
 */
export async function pedirJson<T>(
  ruta: string,
  cfg: FfcvConfig = {},
  verificar?: (datos: T) => string | null,
): Promise<FfcvResultado<T>> {
  const base = cfg.base ?? FFCV_BASE;
  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as FfcvFetch);
  const intentos = cfg.intentos ?? FFCV_INTENTOS;
  const esperaMs = cfg.esperaMs ?? FFCV_ESPERA_MS;
  const esperar = cfg.esperar ?? esperaPorDefecto;
  const ahora = cfg.ahora ?? Date.now;
  const marcapasos = cfg.marcapasos ?? marcapasosCompartido;
  const intentos429 = cfg.intentos429 ?? FFCV_INTENTOS_429;
  const espera429 = cfg.espera429Ms ?? FFCV_ESPERA_429_MS;

  let token = cfg.token;
  if (!token) {
    const t = await leerToken(cfg);
    if (!t.ok) return t;
    token = t.datos;
  }

  let ultimaDegradacion = 'sin detalle';
  let intento = 1;
  let limitadas = 0;
  let esperadoMs = 0;

  /**
   * Espera lo que toque, o dice que NO hay tiempo. Mira el vencimiento ANTES de dormir,
   * no después: comprobarlo después ya habría gastado el tiempo que se quería ahorrar.
   */
  const aguardar = async (ms: number): Promise<boolean> => {
    if (cfg.vencimientoMs !== undefined && ahora() + ms > cfg.vencimientoMs) return false;
    await esperar(ms);
    esperadoMs += ms;
    return true;
  };

  while (intento <= intentos) {
    let res: Response;
    await marcapasos.pedirTurno(esperar, ahora);
    try {
      res = await doFetch(base + ruta, {
        method: 'GET',
        headers: {
          [FFCV_CABECERA_TOKEN]: token,
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
    } catch (e) {
      // Red caída: cuenta como degradación y se reintenta.
      ultimaDegradacion = `fetch: ${String(e)}`;
      if (intento < intentos && !(await aguardar(esperaDeIntento(intento, esperaMs)))) {
        return { ok: false, fallo: { motivo: 'agotado', esperadoMs, detalle: ultimaDegradacion } };
      }
      intento += 1;
      continue;
    }

    // EL 429 NO GASTA INTENTOS DE DEGRADACIÓN. Son dos averías distintas —el origen caído
    // y nuestro propio ritmo— y juntar sus presupuestos deja al límite comiéndose los
    // reintentos del 503: la llamada que necesitó tres intentos por 503 se habría
    // quedado sin ninguno. Tampoco se reintenta con los 3 s de la degradación, porque la
    // ventana medida dura medio minuto y volver antes es gastar un intento a cambio de
    // nada.
    if (res.status === 429) {
      limitadas += 1;
      if (limitadas >= intentos429) {
        return { ok: false, fallo: { motivo: 'limitado', intentos: limitadas } };
      }
      if (!(await aguardar(espera429))) {
        return { ok: false, fallo: { motivo: 'agotado', esperadoMs, detalle: 'HTTP 429' } };
      }
      continue;
    }

    let payload: unknown;
    let texto = '';
    try {
      texto = await res.text();
      payload = JSON.parse(texto) as unknown;
    } catch {
      // Un 5xx con cuerpo no-JSON es el origen caído; un 200 no-JSON es otra cosa.
      if (res.status >= 500) {
        ultimaDegradacion = `HTTP ${res.status} con cuerpo no JSON`;
        if (intento < intentos && !(await aguardar(esperaDeIntento(intento, esperaMs)))) {
          return { ok: false, fallo: { motivo: 'agotado', esperadoMs, detalle: ultimaDegradacion } };
        }
        intento += 1;
        continue;
      }
      return {
        ok: false,
        fallo: { motivo: 'no_json', detalle: texto.slice(0, 200) },
      };
    }

    const degradado = motivoDeDegradacion(payload);
    if (degradado !== null) {
      ultimaDegradacion = degradado;
      if (intento < intentos && !(await aguardar(esperaDeIntento(intento, esperaMs)))) {
        return { ok: false, fallo: { motivo: 'agotado', esperadoMs, detalle: ultimaDegradacion } };
      }
      intento += 1;
      continue;
    }

    // Ojo al orden: un 503 "limpio" (JSON sin marcas) llega aquí; también se reintenta.
    if (res.status >= 500) {
      ultimaDegradacion = `HTTP ${res.status}`;
      if (intento < intentos && !(await aguardar(esperaDeIntento(intento, esperaMs)))) {
        return { ok: false, fallo: { motivo: 'agotado', esperadoMs, detalle: ultimaDegradacion } };
      }
      intento += 1;
      continue;
    }
    if (!res.ok) return { ok: false, fallo: { motivo: 'http', status: res.status } };

    const rechazo = motivoDeRechazo(payload);
    if (rechazo !== null) return { ok: false, fallo: { motivo: 'api', detalle: rechazo } };

    const datos = payload as T;
    if (verificar) {
      const queja = verificar(datos);
      if (queja !== null) {
        return { ok: false, fallo: { motivo: 'filtro_ignorado', detalle: queja } };
      }
    }
    return { ok: true, datos };
  }

  return {
    ok: false,
    fallo: { motivo: 'degradado', intentos, detalle: ultimaDegradacion },
  };
}
