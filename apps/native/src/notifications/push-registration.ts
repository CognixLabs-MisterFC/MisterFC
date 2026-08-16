import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@misterfc/core';

/**
 * O2-4 PR-2 — Registro del Expo push token del dispositivo.
 *
 * El token se registra con la RPC `register_expo_push_token(token,'android',info)`
 * de PR-1 (UNIQUE(token) + upsert: reasigna al usuario que registra, ver PR-1).
 * `getExpoPushTokenAsync` falla de forma transitoria → reintentos con backoff.
 * Nada aquí LANZA hacia el arranque: el push es best-effort, no bloquea la app.
 *
 * Separación deliberada (réplica del patrón web, ver 0a):
 *   - `registerPushTokenIfPermitted` NO pide permiso: solo registra si YA está
 *     concedido. Se llama tras login (silencioso).
 *   - `enablePushNotifications` SÍ pide permiso: lo dispara el usuario desde la
 *     tarjeta de ajustes del perfil (equivalente al botón "Activar push" web).
 */

const ANDROID_CHANNEL_ID = 'default';

/** Canal Android 'default' — el emisor de PR-1 manda `channelId:'default'`. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'General',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

function projectId(): string | undefined {
  const eas = Constants.expoConfig?.extra?.eas as
    | { projectId?: string }
    | undefined;
  return eas?.projectId;
}

/** Etiqueta legible del dispositivo para `device_info` (auditoría/depuración). */
function deviceInfo(): string {
  return [
    Device.manufacturer,
    Device.modelName,
    Device.osVersion ? `Android ${Device.osVersion}` : null,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' · ')
    .slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Paso del registro donde ocurre el fallo (para tags/agrupación en Sentry). */
type PushStep = 'expo-token' | 'rpc' | 'register';

/**
 * Reporta a Sentry un fallo del registro de push (los `catch` de este flujo lo
 * tragaban y el usuario solo veía un error genérico). Señal DEFINITIVA: la misma
 * que queremos en producción con un club real.
 *
 * PRIVACIDAD (datos de menores): NUNCA se manda user_id, email ni el token de push
 * completo — solo si el token existe y su longitud. El `projectId` es config de la
 * app (app.json), no dato personal. El mensaje del error es técnico (Expo/Postgres).
 */
function reportPushFailure(
  step: PushStep,
  reason: string,
  message: string,
  extra: Record<string, unknown>,
  cause?: unknown,
): void {
  const error = cause instanceof Error ? cause : new Error(message);
  Sentry.withScope((scope) => {
    scope.setTag('push_step', step);
    scope.setTag('push_reason', reason);
    scope.setContext('push', {
      step,
      reason,
      message,
      platform: Platform.OS,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

/**
 * Obtiene el Expo push token con reintentos + backoff (transitorio). Devuelve
 * null si agota los intentos, sin lanzar.
 */
async function getExpoTokenWithRetry(attempts = 3): Promise<string | null> {
  const pid = projectId();
  const delays = [500, 1500, 4000];
  for (let i = 0; i < attempts; i++) {
    try {
      const { data } = await Notifications.getExpoPushTokenAsync(
        pid ? { projectId: pid } : undefined,
      );
      if (data) return data;
    } catch (err) {
      // Los intentos previos son transitorios (backoff y reintento); en el ÚLTIMO
      // reportamos la causa REAL (proyecto Expo sin credencial FCM, projectId
      // ausente, FCM no inicializado en el APK…), que hasta ahora se perdía.
      if (i === attempts - 1) {
        reportPushFailure(
          'expo-token',
          'no-token',
          'getExpoPushTokenAsync falló tras reintentos',
          { hasProjectId: Boolean(pid), projectId: pid ?? null, attempts },
          err,
        );
      }
    }
    if (i < attempts - 1) await sleep(delays[i] ?? 4000);
  }
  return null;
}

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'no-permission' | 'no-token' | 'rpc-error' };

/**
 * Registra el token SOLO si el permiso ya está concedido (no lo pide). Se llama
 * tras login. No lanza nunca.
 */
export async function registerPushTokenIfPermitted(
  supabase: SupabaseClient<Database>,
): Promise<RegisterResult> {
  try {
    // Android-only en O2-4 (iOS pospuesto: sin APNs configurado).
    if (Platform.OS !== 'android') return { ok: false, reason: 'no-permission' };

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'no-permission' };

    await ensureAndroidChannel();
    const token = await getExpoTokenWithRetry();
    if (!token) return { ok: false, reason: 'no-token' };

    const { error } = await supabase.rpc('register_expo_push_token', {
      p_token: token,
      p_platform: 'android',
      p_device_info: deviceInfo(),
    });
    if (error) {
      // La RPC devolvió error (p.ej. 28000 sin sesión). Adjuntamos código/mensaje
      // de Postgres (técnicos, sin PII) para saber la causa exacta.
      reportPushFailure(
        'rpc',
        'rpc-error',
        `register_expo_push_token: ${error.message}`,
        {
          rpcCode: error.code ?? null,
          rpcDetails: error.details ?? null,
          rpcHint: error.hint ?? null,
          tokenPresent: token.length > 0,
          tokenLength: token.length,
        },
      );
      return { ok: false, reason: 'rpc-error' };
    }
    return { ok: true, token };
  } catch (err) {
    // La RPC (o un paso previo) LANZÓ, no devolvió error: red caída, etc. También
    // se perdía; lo reportamos como 'register' para distinguirlo de la rama de arriba.
    reportPushFailure(
      'register',
      'exception',
      'registerPushTokenIfPermitted lanzó una excepción',
      {},
      err,
    );
    return { ok: false, reason: 'rpc-error' };
  }
}

/**
 * Motivo del fallo de activación, para que la UI distinga sin tecnicismos:
 *   - 'device' → no se pudo obtener el permiso/token del dispositivo.
 *   - 'server' → sí hubo token, pero no se pudo guardar en el servidor (RPC).
 */
export type EnableErrorReason = 'device' | 'server';

export type EnableResult =
  | { status: 'enabled' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; reason: EnableErrorReason };

/**
 * Pide el permiso (acción explícita del usuario, réplica del botón web) y, si se
 * concede, registra el token. Para la tarjeta de ajustes del perfil.
 */
export async function enablePushNotifications(
  supabase: SupabaseClient<Database>,
): Promise<EnableResult> {
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      return { status: 'denied', canAskAgain: perm.canAskAgain ?? false };
    }
    const res = await registerPushTokenIfPermitted(supabase);
    if (res.ok) return { status: 'enabled' };
    // 'rpc-error' = el token se obtuvo pero no se guardó → 'server'; el resto
    // (no-token / no-permission) es del lado del dispositivo → 'device'.
    return { status: 'error', reason: res.reason === 'rpc-error' ? 'server' : 'device' };
  } catch (err) {
    // Aquí solo puede llegar un throw de requestPermissionsAsync (register tiene su
    // propio catch): fallo del lado del dispositivo.
    reportPushFailure(
      'expo-token',
      'exception',
      'enablePushNotifications lanzó al pedir permiso',
      {},
      err,
    );
    return { status: 'error', reason: 'device' };
  }
}

export type PermissionView = 'granted' | 'undetermined' | 'denied';

/** Estado del permiso para pintar la tarjeta (concedido / se puede pedir / bloqueado). */
export async function currentPermissionView(): Promise<PermissionView> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) return 'granted';
    return perm.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}
