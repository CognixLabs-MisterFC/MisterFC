// Redacción PURA para los eventos de Sentry (O2-12b, ampliación #450).
//
// Este módulo NO importa @sentry/react-native ni ejecuta ningún efecto: son
// funciones puras sobre objetos planos, para poder testearlas en Node sin el
// runtime nativo. `sentry.ts` las importa y las cablea en Sentry.init.
//
// La app maneja datos de MENORES. La política es: NO enviar identidad ni
// contenido de usuario. Aquí solo se redactan TOKENS y QUERY STRINGS — nunca
// se hace heurística de nombres/emails/fechas (generaría falsos positivos que
// destrozarían la utilidad del error).

// JSON Web Tokens / tokens de aspecto bearer (el de secure-store).
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// URL con query embebida en texto libre: `https://host/path?token=…` → corta
// desde el `?` (los tokens de URLs firmadas de Supabase Storage y los deep
// links viajan ahí). El grupo 1 conserva la URL base sin query ni fragmento.
const EMBEDDED_URL_QUERY_RE = /(https?:\/\/[^\s?#]+)\?[^\s]*/g;

/**
 * Redacta tokens JWT/bearer y recorta el query de cualquier URL embebida en un
 * texto libre. Un string sin nada que redactar se devuelve intacto.
 */
export function redact(value: string): string {
  return value.replace(EMBEDDED_URL_QUERY_RE, '$1').replace(JWT_RE, '[redacted-token]');
}

/**
 * Quita el query string de una URL tomada como valor completo (no embebida):
 * `event.request.url`, `breadcrumb.data.url`. Corta en el primer `?` y aplica
 * `redact` al resto. Valores no-string se devuelven tal cual (no peta).
 */
export function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  const clean = q >= 0 ? url.slice(0, q) : url;
  return redact(clean);
}

// Formas MÍNIMAS y estructurales de lo que tocamos del Event/Breadcrumb del
// SDK. No importamos los tipos de @sentry para mantener el módulo desacoplado
// y testeable; el Event real del SDK es asignable a estas (campos opcionales).
export interface SanitizableRequest {
  url?: string;
  cookies?: unknown;
  headers?: unknown;
}
export interface SanitizableException {
  value?: string;
}
export interface SanitizableEvent {
  user?: unknown;
  // Shape REAL del SDK (@sentry/core 10.x): `message` es un string plano y la
  // forma estructurada vive en `logentry.message` — NO existe `.formatted`.
  // Redactamos ambos.
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  request?: SanitizableRequest;
  exception?: { values?: SanitizableException[] };
}
export interface SanitizableBreadcrumb {
  category?: string;
  message?: string;
  data?: unknown;
}

/**
 * Anonimiza y limpia un evento antes de enviarlo. Muta el objeto en sitio y lo
 * devuelve (mismo referente). Idempotente sobre datos ya limpios.
 */
export function sanitizeEvent<T extends SanitizableEvent>(event: T): T {
  // Informes ANÓNIMOS: fuera el usuario ENTERO (ni el id).
  delete event.user;

  // Cabeceras/cookies de autorización + query de la URL de la request.
  if (event.request) {
    delete event.request.cookies;
    const h = event.request.headers as Record<string, unknown> | undefined;
    if (h) {
      delete h['Authorization'];
      delete h['authorization'];
      delete h['Cookie'];
      delete h['cookie'];
    }
    event.request.url = stripQuery(event.request.url) as string | undefined;
  }

  // Mensaje del evento (texto libre): tokens + URLs con query.
  if (typeof event.message === 'string') {
    event.message = redact(event.message);
  }
  if (event.logentry && typeof event.logentry.message === 'string') {
    event.logentry.message = redact(event.logentry.message);
  }

  // Valores de las excepciones: el camino MÁS probable por el que se colaría
  // contenido de usuario (errores de validación/parseo que arrastran el dato).
  if (event.exception && Array.isArray(event.exception.values)) {
    for (const ex of event.exception.values) {
      if (ex && typeof ex.value === 'string') {
        ex.value = redact(ex.value);
      }
    }
  }

  return event;
}

/**
 * Limpia un breadcrumb: quita el query y las cabeceras de auth de los de red y
 * redacta tokens en el mensaje. Muta en sitio y devuelve el mismo referente.
 */
export function sanitizeBreadcrumb<T extends SanitizableBreadcrumb>(breadcrumb: T): T {
  if (
    breadcrumb.category === 'http' ||
    breadcrumb.category === 'xhr' ||
    breadcrumb.category === 'fetch'
  ) {
    const data = breadcrumb.data as Record<string, unknown> | undefined;
    if (data) {
      if ('url' in data) data.url = stripQuery(data.url);
      delete data['Authorization'];
      delete data['authorization'];
    }
  }
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = redact(breadcrumb.message);
  }
  return breadcrumb;
}
