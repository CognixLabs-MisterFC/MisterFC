import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyClock,
  getMySubscriptionStatusFromClient,
  type SubscriptionStatus,
} from '@misterfc/core';
import { useSession } from '@/auth/session';
import { supabase } from '@/lib/supabase';
import { canPurchase, configurePurchases } from '@/subscription/purchases';

/**
 * SU-4 — estado de suscripción de la app. El SERVIDOR es la autoridad: el gate lee
 * `my_subscription_status()`, no el `isActive` del SDK.
 *
 * Por qué no el SDK, si ADR-0022 dice que se puede leer `isActive`: porque el SDK
 * responde por lo que hay CACHEADO EN ESTE DISPOSITIVO, y eso es justo lo que no
 * queremos que abra la puerta — es el camino por el que un "restaurar compras" podría
 * dar acceso sin que el servidor haya visto nada. `isActive` se usa para saber si la
 * COMPRA salió bien, no para decidir el acceso.
 *
 * Lo que sí se hace en local es **recalcular con el reloj**: el estado se cachea y el
 * acceso depende de una fecha, así que `applyClock` se vuelve a evaluar en
 * cada render con `Date.now()`. Sin eso, una suscripción que vence con la app abierta
 * seguiría dando acceso hasta el siguiente refresco.
 *
 * ⚠️ EL GATE SE ENVÍA APAGADO. Solo bloquea si `EXPO_PUBLIC_SUBSCRIPTION_GATE` vale
 * exactamente `'on'`. Motivo: encenderlo antes de que las DOS tiendas puedan cobrar
 * deja fuera a familias que no tienen forma de pagar, y hoy Play no está configurado.
 * Lo enciende el operador cuando los dos productos estén vivos.
 */

export const SUBSCRIPTION_GATE_ENABLED = process.env.EXPO_PUBLIC_SUBSCRIPTION_GATE === 'on';

type SubscriptionState = {
  /** null mientras no se ha podido leer nada todavía. */
  status: SubscriptionStatus | null;
  loading: boolean;
  /** La última lectura falló. NO se traduce a "sin acceso": son cosas distintas. */
  error: boolean;
  /** ¿Hay que enseñar el muro AHORA? Ya tiene en cuenta el flag y el reloj. */
  blocked: boolean;
  refresh: () => Promise<void>;
  /**
   * Tras comprar: reintenta hasta que el webhook llegue al servidor. `attempts` se
   * pasa corto (SU-6b) cuando ya se ha reclamado al servidor y la fila TIENE que estar:
   * ahí no hay nada que esperar, solo confirmar.
   */
  waitForEntitlement: (attempts?: number) => Promise<boolean>;
};

const SubscriptionContext = createContext<SubscriptionState>({
  status: null,
  loading: true,
  error: false,
  blocked: false,
  refresh: async () => {},
  waitForEntitlement: async () => false,
});

/** Reintentos tras una compra: el webhook tarda segundos, no minutos. */
const POST_PURCHASE_ATTEMPTS = 8;
const POST_PURCHASE_DELAY_MS = 1500;

/** Cada cuánto se vuelve a mirar el reloj para cerrar un acceso que acaba de vencer. */
const CLOCK_TICK_MS = 60_000;

/** Lo último que se leyó del servidor. `error` no borra el `status` anterior. */
type Read = { status: SubscriptionStatus | null; error: boolean };

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  // `null` = todavía no se ha leído nada. En el error se CONSERVA lo último que se supo:
  // una lectura muda no puede degradarse a "sin acceso".
  const [read, setRead] = useState<Read | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // El reloj vive en el estado, no un contador: el acceso depende de una FECHA y hay que
  // volver a evaluarla aunque nadie navegue. Guardar el instante (y no un tick) lo
  // convierte en una dependencia de verdad del cálculo.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      const res = await getMySubscriptionStatusFromClient(supabase);
      if (!alive) return;
      setRead((prev) =>
        res.ok
          ? { status: res.status, error: false }
          : { status: prev?.status ?? null, error: true },
      );
    })();
    return () => {
      alive = false;
    };
  }, [user, reloadKey]);

  // El SDK se identifica con nuestro `profiles.id` en cuanto hay sesión. Solo se hace
  // aquí: ningún otro sitio llama a `logIn`.
  useEffect(() => {
    if (!user) return;
    void configurePurchases(user.id);
  }, [user]);

  useEffect(() => {
    if (!SUBSCRIPTION_GATE_ENABLED) return;
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    setReloadKey((k) => k + 1);
  }, []);

  const waitForEntitlement = useCallback(async (
    attempts: number = POST_PURCHASE_ATTEMPTS,
  ): Promise<boolean> => {
    for (let i = 0; i < attempts; i += 1) {
      const res = await getMySubscriptionStatusFromClient(supabase);
      if (res.ok && res.status.hasAccess) {
        setRead({ status: res.status, error: false });
        return true;
      }
      await new Promise((r) => setTimeout(r, POST_PURCHASE_DELAY_MS));
    }
    setReloadKey((k) => k + 1);
    return false;
  }, []);

  const value = useMemo<SubscriptionState>(() => {
    // Sin sesión no hay nada que vigilar.
    const loading = user !== null && read === null;
    const error = read?.error ?? false;
    // El servidor resolvió el estado; aquí solo se vuelve a mirar el reloj.
    const status = read?.status ? applyClock(read.status, now) : null;

    // Mientras no se sepa nada, NO se bloquea: un muro sin datos es peor que un
    // instante de app visible, y el gatekeeper ya muestra el splash. Un error de
    // lectura tampoco bloquea: pondría el muro a quien ha pagado.
    const blocked =
      SUBSCRIPTION_GATE_ENABLED && status !== null && !loading && !error
        ? status.requiresSubscription && !status.hasAccess
        : false;

    return { status, loading, error, blocked, refresh, waitForEntitlement };
  }, [user, read, now, refresh, waitForEntitlement]);

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionState {
  return useContext(SubscriptionContext);
}

/** Reexport para la pantalla: si no se puede cobrar, se dice, no se ofrece. */
export { canPurchase };
