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
 * ── UN ESTADO QUE NO ES DEGRADACIÓN ─────────────────────────────────────────────────
 * El proxy marca sus respuestas con `estado`: '1' bien, '0' mal. Un '0' SIN marcas de
 * degradación (ni `code_api`, ni `_upstream`, ni la palabra «degradado») no es el origen
 * cayéndose: es la API diciendo que no. Se distingue a propósito, porque reintentar
 * cuatro veces un «no» es ruido y porque confundirlos haría ilegible el diagnóstico.
 */

import type { FfcvFetch } from './types';

export const FFCV_BASE = 'https://ffcv.es/competiciones/';
export const FFCV_CABECERA_TOKEN = 'X-FFCV-Page-Token';
/** 4 intentos: la peor llamada medida necesitó 3. */
export const FFCV_INTENTOS = 4;
export const FFCV_ESPERA_MS = 3_000;

export type FfcvConfig = {
  base?: string;
  fetchImpl?: FfcvFetch;
  intentos?: number;
  esperaMs?: number;
  /** Inyectable para que los tests no duerman de verdad. */
  esperar?: (ms: number) => Promise<void>;
  /** Token ya conocido. Si falta, se raspa de la portada en la 1ª llamada. */
  token?: string;
};

export type FfcvFallo =
  | { motivo: 'sin_token'; detalle: string }
  | { motivo: 'http'; status: number }
  | { motivo: 'no_json'; detalle: string }
  | { motivo: 'degradado'; intentos: number; detalle: string }
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

/** Raspa el token de la portada de /competiciones/. */
export async function leerToken(cfg: FfcvConfig = {}): Promise<FfcvResultado<string>> {
  const base = cfg.base ?? FFCV_BASE;
  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as FfcvFetch);
  let res: Response;
  try {
    res = await doFetch(base, { method: 'GET' });
  } catch (e) {
    return { ok: false, fallo: { motivo: 'sin_token', detalle: String(e) } };
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

  let token = cfg.token;
  if (!token) {
    const t = await leerToken(cfg);
    if (!t.ok) return t;
    token = t.datos;
  }

  let ultimaDegradacion = 'sin detalle';
  for (let intento = 1; intento <= intentos; intento += 1) {
    let res: Response;
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
      if (intento < intentos) await esperar(esperaMs);
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
        if (intento < intentos) await esperar(esperaMs);
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
      if (intento < intentos) await esperar(esperaMs);
      continue;
    }

    // Ojo al orden: un 503 "limpio" (JSON sin marcas) llega aquí; también se reintenta.
    if (res.status >= 500) {
      ultimaDegradacion = `HTTP ${res.status}`;
      if (intento < intentos) await esperar(esperaMs);
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
