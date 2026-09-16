/**
 * W-A — la DECISIÓN del corte de la web para familias, sin cliente de Sentry ni
 * variables de entorno.
 *
 * Vive en core y no en `apps/web` por el mismo motivo que `subscription/gate.ts`:
 * **`apps/web` no tiene runner de tests**, y equivocarse aquí significa o enseñarle a un
 * entrenador una pantalla de «descárgate la app» en mitad de un partido, o dejar la web
 * abierta a quien se quería sacar de ella.
 *
 * ── DÓNDE SE APLICA ──────────────────────────────────────────────────────────────────
 *
 * En los DOS puntos comunes de la web, los mismos que SU-5:
 *   · `(authenticated)/layout.tsx` — todo lo autenticado con club;
 *   · `spectator/layout.tsx` — la carcasa del seguidor puro, que es HERMANA de la
 *     anterior y NO cuelga de su layout. Es el punto que se olvida.
 *
 * NO va en `middleware.ts`, y no es una preferencia de estilo: la nativa llama a **13
 * route handlers de la web con Bearer**, seis de ellos desde pantallas de familia
 * (`messages/send`, `players/self-invite`, `spectators/invite`, `subscription/claim`,
 * `account/deletion/request` y `/cancel`). Los route handlers no cruzan ningún layout,
 * así que un corte puesto aquí no puede romper la app por accidente. El middleware hoy
 * excluye `api` en su matcher, pero eso es una línea que alguien puede editar.
 *
 * ── SE ENVÍA APAGADO ─────────────────────────────────────────────────────────────────
 *
 * Igual que el gate de suscripción. Y a diferencia de aquel, aquí el interruptor es UNO
 * SOLO y solo de la web (decisión 4 de Jose): la app no se entera de nada, porque la app
 * es el destino, no una de las dos mitades de un muro que hay que encender a la vez.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getMySubscriptionStatusFromClient } from '../subscription/reads';

type DbClient = SupabaseClient<Database>;

export type FamilyWebCutDecision =
  /** A la app. Hay que enseñar la página de «ya puedes entrar desde la aplicación». */
  | { closed: true }
  /** Sigue navegando. */
  | { closed: false; reason: FamilyWebOpenReason };

export type FamilyWebOpenReason =
  /** El interruptor de despliegue está apagado. */
  | 'cut_off'
  /** No se pudo leer quién es. NO se cierra: ver la nota de abajo. */
  | 'unreadable'
  /** Staff, dirección o superadmin: la web es suya y no se toca. */
  | 'staff';

export type FamilyWebCutDeps = {
  /** `FAMILY_WEB_CUT === 'on'` en la web. Una sola variable, y solo de la web. */
  enabled: boolean;
  /** Se llama SOLO cuando la lectura falla. El caller decide si alerta. */
  onUnreadable?: (raw: unknown) => void;
};

/**
 * La decisión pura. `isFamily = null` significa «no se ha podido leer».
 *
 * ── POR QUÉ UNA LECTURA FALLIDA DEJA PASAR ───────────────────────────────────────────
 *
 * El gate de suscripción falla hacia abierto porque cerrar pondría un muro de pago a una
 * familia que YA HA PAGADO. Aquí el motivo es otro y conviene no confundirlos:
 *
 *  · cerrar por error le enseña a un entrenador —o a un director— una pantalla que le
 *    dice que se descargue la app de familia. No pierde datos, pero pierde el acceso a
 *    su herramienta y no entiende por qué;
 *  · abrir por error le deja a una familia la web durante una carga de página. Eso no
 *    abre ninguna puerta: **este corte es una decisión de PRODUCTO, no una de
 *    autorización**. La RLS sigue exactamente donde estaba, y una familia que se salte
 *    el corte no ve ni un dato más del que veía ayer.
 *
 * Con las consecuencias tan desequilibradas, la dirección benigna es evidente.
 */
export function decideFamilyWebCut(
  enabled: boolean,
  isFamily: boolean | null,
): FamilyWebCutDecision {
  if (!enabled) return { closed: false, reason: 'cut_off' };
  if (isFamily === null) return { closed: false, reason: 'unreadable' };
  if (!isFamily) return { closed: false, reason: 'staff' };
  return { closed: true };
}

/**
 * Lee y decide.
 *
 * ── DE DÓNDE SALE «ES FAMILIA» ───────────────────────────────────────────────────────
 *
 * De `my_subscription_status()`, que ya devuelve `requires_subscription` resuelto por el
 * SQL. Y sí: eso es el predicado de la OTRA pregunta (ver la cabecera de `rules.ts`).
 * Se usa porque es el único lector expuesto que existe, y porque calcular los vínculos
 * desde el cliente serían cuatro lecturas bajo RLS con cuatro formas nuevas de fallar —
 * además de imposible en `/spectator`, donde el seguidor puro no tiene ni una membership
 * que mirar.
 *
 * Lo que hace que esto no sea una trampa es el test de contrato de `rules.ts`: el día
 * que `isFamilyAccount` y `requiresSubscription` dejen de coincidir, esa RPC deja de ser
 * una fuente válida para esta pregunta y hará falta SQL propio. Ese día el test lo dice.
 *
 * `decideFamilyWebCut` se expone aparte porque la decisión se puede tomar sin cliente en
 * cuanto se sepa el dato, y así se prueba entera sin inventar un servidor. NO hay doble
 * lectura que ahorrar en la web: el corte va DESPUÉS del gate de suscripción y, cuando
 * cierra, `redirect()` corta la ejecución, así que las dos RPC nunca coinciden en la
 * misma request salvo en el camino de una lectura rota.
 */
export async function evaluateFamilyWebCutFromClient(
  supabase: DbClient,
  deps: FamilyWebCutDeps,
): Promise<FamilyWebCutDecision> {
  if (!deps.enabled) return { closed: false, reason: 'cut_off' };

  const res = await getMySubscriptionStatusFromClient(supabase);
  if (!res.ok) {
    deps.onUnreadable?.(res.raw);
    return decideFamilyWebCut(true, null);
  }

  return decideFamilyWebCut(true, res.status.requiresSubscription);
}
