import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import { router, useRootNavigationState, type Href } from 'expo-router';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { supabase } from '@/lib/supabase';
import { chromeAreaFor } from './area';
import { registerPushTokenIfPermitted } from './push-registration';
import { needsLinkedPlayers, targetFromResponse } from './deep-link';

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
 *
 * PUSH-ÁREA — el área de destino ya no es siempre la del rol. Un aviso cuyos
 * destinatarios salen de `player_accounts` (la convocatoria del hijo, su informe,
 * su jugada) se recibe por ser TUTOR: a un director-tutor le abría la lista de
 * convocatorias de dirección —club-wide y en solo lectura— en vez de la de su hija.
 * La regla vive en core (`nativeTargetForNotification`); aquí se le pasa el hogar y
 * si hay hijos vinculados, y se espera ese dato SOLO cuando cambia la respuesta.
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

  // El área HOGAR (la del rol). Desde PUSH-ÁREA ya no es la única posible: un aviso
  // sobre un hijo abre familia, y eso depende de la lista de hijos vinculados —el
  // mismo dato que abre el modo tutor en el AreaGuard—, que llega en asíncrono.
  const area = chromeAreaFor(app.kind, app.activeClub?.role ?? null);
  const linkedPlayers = useActivePlayer();
  const hasLinkedPlayers = linkedPlayers.players.length > 0;

  // Respuesta de push pendiente de enrutar (del cold-start o del listener).
  const [pending, setPending] = useState<NotificationResponse | null>(null);
  // Identificador de la última respuesta YA enrutada (ver el efecto 3b).
  const routedIdRef = useRef<string | null>(null);

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
    // ESPERAR A LOS HIJOS, PERO SOLO CUANDO CAMBIAN LA RESPUESTA. Para un aviso de
    // audiencia familia, enrutar antes de saber si hay hijos vinculados mandaría al
    // director-tutor a su hogar —y ya no habría forma de corregirlo: la navegación
    // no se deshace—. Para todos los demás el dato es irrelevante y esperarlo solo
    // retrasaría el salto. Mismo criterio que el AreaGuard.
    if (linkedPlayers.loading && needsLinkedPlayers(pending)) return;
    // UNA RESPUESTA SE ENRUTA UNA VEZ. En un arranque POR push, la respuesta llega
    // por los dos caminos —`getLastNotificationResponseAsync` y el listener— y sin
    // esto se navegaría dos veces al mismo sitio. Ahora además importa más: con el
    // salto de área, una segunda navegación tardía podría sacar al usuario de donde
    // acaba de entrar. Nota honesta: esto NO cubre el proceso reiniciado (el ref
    // nace vacío en cada arranque); cubre los dos caminos de una misma sesión.
    const id = pending.notification.request.identifier;
    const yaEnrutada = routedIdRef.current === id;
    if (!yaEnrutada) routedIdRef.current = id;
    (async () => {
      if (!yaEnrutada) {
        const target = targetFromResponse(pending, area, hasLinkedPlayers);
        router.navigate(target as Href);
      }
      // Limpieza async (React Compiler: nada de setState síncrono en el efecto) —
      // también en la rama repetida, que solo descarta.
      setPending(null);
    })();
  }, [routerReady, area, pending, hasLinkedPlayers, linkedPlayers.loading]);

  return null;
}
