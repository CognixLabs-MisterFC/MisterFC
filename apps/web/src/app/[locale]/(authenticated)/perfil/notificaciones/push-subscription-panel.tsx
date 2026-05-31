'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BellOff, BellRing, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { subscribePush, unsubscribePush } from './actions';

type SubscriptionRow = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  last_seen_at: string;
};

type Props = {
  vapidPublicKey: string;
  initialSubscriptions: SubscriptionRow[];
};

/**
 * F5.4/5.5 — panel cliente para gestionar suscripciones Web Push.
 *
 * Estados visibles:
 *   - "no soportado": navegador sin PushManager (iOS Safari fuera de PWA).
 *   - "denegado": Notification.permission === 'denied'.
 *   - "activable": soporta + no suscrito todavía → botón "Activar".
 *   - "activo": al menos una suscripción → muestra lista + botón "Desactivar
 *     en este dispositivo".
 */
export function PushSubscriptionPanel({
  vapidPublicKey,
  initialSubscriptions,
}: Props) {
  const t = useTranslations('notificaciones.push');
  const [subs, setSubs] = useState<SubscriptionRow[]>(initialSubscriptions);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<
    'default' | 'granted' | 'denied' | null
  >(null);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  // Sincroniza con la API del navegador (Notification, PushManager,
  // ServiceWorker) UNA vez tras hydrate. setSupported/setPermission son
  // setState en effect pero éste ES el caso "sync with external system"
  // que la rule de set-state-in-effect documenta como excepción legítima.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ok =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(ok);
    if (ok) {
      setPermission(Notification.permission);
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (sub) setCurrentEndpoint(sub.endpoint);
        })
        .catch(() => {
          // silencioso — solo es info para destacar "este dispositivo".
        });
    }
  }, []);

  async function onSubscribe() {
    setError(null);
    if (!supported) return;
    try {
      // Registra el SW si no lo está aún.
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError(t('error_permission'));
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Browser BufferSource type es estricto en lib.dom; el Uint8Array
        // que generamos es compatible en runtime.
        applicationServerKey: urlBase64ToUint8Array(
          vapidPublicKey,
        ) as unknown as BufferSource,
      });

      const json = sub.toJSON();
      const endpointStr = json.endpoint;
      const p256dhStr = json.keys?.p256dh;
      const authStr = json.keys?.auth;
      if (!endpointStr || !p256dhStr || !authStr) {
        setError(t('error_generic'));
        return;
      }

      startTransition(async () => {
        const res = await subscribePush({
          endpoint: endpointStr,
          p256dh: p256dhStr,
          auth: authStr,
          user_agent: typeof navigator !== 'undefined'
            ? navigator.userAgent.slice(0, 500)
            : undefined,
        });
        if (res.ok) {
          const okPayload = res.ok;
          setCurrentEndpoint(endpointStr);
          setSubs((prev) => [
            ...prev.filter((s) => s.endpoint !== endpointStr),
            {
              id: okPayload.subscription_id,
              endpoint: endpointStr,
              user_agent:
                typeof navigator !== 'undefined'
                  ? navigator.userAgent.slice(0, 500)
                  : null,
              last_seen_at: new Date().toISOString(),
            },
          ]);
        } else {
          setError(t('error_generic'));
        }
      });
    } catch (e) {
      console.error('subscribe push error', e);
      setError(t('error_generic'));
    }
  }

  async function onUnsubscribeLocal() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      const ep = currentEndpoint;
      if (ep) {
        startTransition(async () => {
          await unsubscribePush({ endpoint: ep });
          setSubs((prev) => prev.filter((s) => s.endpoint !== ep));
          setCurrentEndpoint(null);
        });
      }
    } catch (e) {
      console.error('unsubscribe push error', e);
      setError(t('error_generic'));
    }
  }

  async function onRemoveRow(endpoint: string) {
    startTransition(async () => {
      await unsubscribePush({ endpoint });
      setSubs((prev) => prev.filter((s) => s.endpoint !== endpoint));
      if (endpoint === currentEndpoint) setCurrentEndpoint(null);
    });
  }

  if (supported === null) {
    return (
      <div className="text-sm text-muted-foreground">
        <Loader2 className="inline size-4 animate-spin" aria-hidden /> {t('detecting')}
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="rounded-md border border-amber-700/40 bg-amber-900/20 p-3 text-sm">
        <p className="font-medium text-amber-200">{t('unsupported_title')}</p>
        <p className="mt-1 text-amber-100/80">{t('unsupported_body')}</p>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <p className="font-medium">{t('denied_title')}</p>
        <p className="mt-1 text-muted-foreground">{t('denied_body')}</p>
      </div>
    );
  }

  const hasLocalSubscription = Boolean(currentEndpoint);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {hasLocalSubscription ? (
          <Button onClick={onUnsubscribeLocal} disabled={pending} variant="outline">
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BellOff className="size-4" aria-hidden />
            )}
            <span>{t('button_unsubscribe_local')}</span>
          </Button>
        ) : (
          <Button onClick={onSubscribe} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BellRing className="size-4" aria-hidden />
            )}
            <span>{t('button_subscribe')}</span>
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {hasLocalSubscription
            ? t('status_active')
            : permission === 'granted'
              ? t('status_granted_no_sub')
              : t('status_inactive')}
        </span>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {subs.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('devices_label')}
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {subs.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {s.user_agent
                      ? humanizeUA(s.user_agent)
                      : t('device_unknown')}
                    {s.endpoint === currentEndpoint && (
                      <span className="ml-2 rounded bg-misterfc-green/20 px-1.5 py-0.5 text-[10px] font-semibold text-misterfc-green">
                        {t('this_device')}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.last_seen_at).toLocaleString()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveRow(s.endpoint)}
                  disabled={pending}
                  aria-label={t('remove_device')}
                  title={t('remove_device')}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function humanizeUA(ua: string): string {
  // Heurística mínima: solo etiquetar grosso modo el navegador / OS. No
  // intentamos parser real de UA porque la UI solo necesita ayudar al user
  // a distinguir "su iPhone" de "su PC".
  const s = ua.toLowerCase();
  let browser = 'Navegador';
  if (s.includes('chrome')) browser = 'Chrome';
  else if (s.includes('firefox')) browser = 'Firefox';
  else if (s.includes('safari')) browser = 'Safari';
  else if (s.includes('edg/')) browser = 'Edge';
  let os = '';
  if (s.includes('iphone')) os = 'iPhone';
  else if (s.includes('ipad')) os = 'iPad';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os')) os = 'Mac';
  else if (s.includes('linux')) os = 'Linux';
  return os ? `${browser} · ${os}` : browser;
}
