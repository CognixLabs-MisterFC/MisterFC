import { callServerEndpoint } from '@/lib/server-api';

/**
 * SU-6b — reclamación desde la app: "he pagado y sigo bloqueado".
 *
 * Se llama cuando el servidor NO ha visto la compra después de esperar (el webhook se
 * puede perder: reintentan 5 veces y paran). El endpoint pregunta a RevenueCat por la
 * cuenta de quien llama y, si la compra está allí, crea o corrige la fila.
 *
 * Nunca lanza: es un último recurso dentro de un flujo de compra que ya ha ido raro, y
 * lo peor que puede pasar es que siga sin abrirse (y entonces el muro dice lo que ya
 * decía). `no_web_url` / `no_session` salen de `callServerEndpoint` y aquí se tratan como
 * un "no ha podido ser" más.
 */
export type ClaimAttempt = { ok: boolean; outcome: string | null };

export async function claimSubscription(): Promise<ClaimAttempt> {
  try {
    const res = await callServerEndpoint('/api/subscription/claim', { method: 'POST' });
    if (!res.ok) return { ok: false, outcome: null };
    const body = (await res.json()) as { ok?: unknown; outcome?: unknown };
    return {
      ok: body?.ok === true,
      outcome: typeof body?.outcome === 'string' ? body.outcome : null,
    };
  } catch {
    return { ok: false, outcome: null };
  }
}
