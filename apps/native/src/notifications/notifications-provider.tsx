import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import { router, useRootNavigationState, type Href } from 'expo-router';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { supabase } from '@/lib/supabase';
import { chromeAreaFor } from './area';
import { registerPushTokenIfPermitted } from './push-registration';
import { targetFromResponse } from './deep-link';

/**
 * O2-4 PR-2 — Orquestador de push del lado app (no pinta nada). Montado bajo
 * `AppProvider` en el layout raíz. Hace tres cosas:
 *
 *  1. Configura cómo se muestra un push en primer plano (banner + lista).
 *  2. Tras login, registra el token del dispositivo SI el permiso ya está
 *     concedido (silencioso; el permiso lo pide la tarjeta del perfil).
 *  3. Enruta el TAP de un push a su pantalla: primer plano, segundo plano y
 *     arranque en frío (`getLastNotificationResponseAsync`). La navegación espera
 *     a que el router esté montado (`useRootNavigationState`) Y a conocer el área
 *     del usuario — así el cold-start no se pierde por navegar antes de tiempo.
 */

// Handler global (una vez, al importar el módulo): en primer plano mostramos el
// aviso; el badge lo gestiona (o no) un PR aparte.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function NotificationsProvider() {
  const { user } = useSession();
  const app = useApp();
  const navState = useRootNavigationState();
  const routerReady = Boolean(navState?.key);

  const area = chromeAreaFor(app.kind, app.activeClub?.role ?? null);

  // Respuesta de push pendiente de enrutar (del cold-start o del listener).
  const [pending, setPending] = useState<NotificationResponse | null>(null);

  // (2) Registro silencioso del token cuando hay sesión.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      await registerPushTokenIfPermitted(supabase);
      // El resultado no gobierna UI aquí; la tarjeta del perfil refleja el estado.
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // (3a) Captura de respuestas: cold-start + listener en vivo → a `pending`.
  useEffect(() => {
    let active = true;
    (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (active && last) setPending(last);
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      setPending(resp);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // (3b) Enruta cuando router + área listos. Si aún no lo están, el efecto se
  // re-ejecuta al cambiar `routerReady`/`area` sin perder la respuesta.
  useEffect(() => {
    if (!routerReady || !area || !pending) return;
    (async () => {
      const target = targetFromResponse(pending, area);
      router.navigate(target as Href);
      // Limpieza async (React Compiler: nada de setState síncrono en el efecto).
      setPending(null);
    })();
  }, [routerReady, area, pending]);

  return null;
}
