import { downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';

/**
 * O2-5 F1 — Cliente HTTP hacia los ROUTE HANDLERS de Next (apps/web). La app NO
 * tiene la service-role key: para las escrituras server-side (PDF, y en F2 envío
 * de mensajes / invitar) llama por HTTPS con `Authorization: Bearer <access_token
 * de Supabase>`. El route handler valida el token (getUser) y aplica el gate del
 * usuario (RLS/RPC) ANTES de cualquier efecto con service-role.
 *
 * Base URL configurable por `EXPO_PUBLIC_WEB_URL` (dominio de la web). El operador
 * la fija; sin ella, las llamadas fallan con `no_web_url` (nunca apuntan a un host
 * por defecto). El token sale de la sesión persistida en secure-store cifrado.
 */

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? '';

export function webBaseUrl(): string {
  return WEB_URL.replace(/\/+$/, '');
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Llamada JSON a un route handler con bearer (para F2: envío/invitar). Lanza
 * `no_web_url` / `no_session` si falta config o sesión. El llamante envuelve por
 * el write-guard (sin red → no llama).
 */
export async function callServerEndpoint(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  const base = webBaseUrl();
  if (!base) throw new Error('no_web_url');
  const token = await accessToken();
  if (!token) throw new Error('no_session');
  return fetch(`${base}${path}`, {
    method: init?.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
}

/**
 * Descarga un fichero binario (PDF) del route handler con bearer y devuelve la URI
 * local (cache) para compartir/abrir. Lanza si falta config/sesión o si el HTTP no
 * es 200 (p.ej. 401/403/404 del gate del servidor).
 */
export async function downloadServerFile(
  path: string,
  filename: string,
): Promise<string> {
  const base = webBaseUrl();
  if (!base) throw new Error('no_web_url');
  const token = await accessToken();
  if (!token) throw new Error('no_session');
  const target = `${cacheDirectory ?? ''}${filename}`;
  const res = await downloadAsync(`${base}${path}`, target, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`http_${res.status}`);
  return res.uri;
}
