import { isMatchGoal } from '@misterfc/core';

/**
 * EL EMPUJÓN DEL GOL — la mitad de la app.
 *
 * Tras confirmarse la subida de un evento del directo, si ese evento es un gol se le
 * pide a la web que mande YA las notificaciones de push que el trigger acaba de crear
 * (`POST /api/directo/goal-push`). Sin esto el aviso sale igual, pero lo saca el cron
 * de cada minuto; con esto sale con el gol.
 *
 * REGLA DE LA QUE DEPENDE TODO LO DEMÁS: esto NO puede afectar a la cola. El gol ya
 * está subido y pintado cuando se llama; el push es un extra. Por eso la función no
 * lanza NUNCA y devuelve un resultado que el llamante puede ignorar sin perder nada —
 * si falla, el drenador de cada minuto lo recoge.
 *
 * El `call` entra por parámetro (en la app, `callServerEndpoint`) como en
 * `submitPasswordRecovery`: es lo que permite probar esto en Node, sin runtime de RN.
 */

/** Quien sabe hablar con la web. En la app, `callServerEndpoint` (lleva el bearer). */
export type NudgeCaller = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<Response>;

export const GOAL_PUSH_PATH = '/api/directo/goal-push';

/**
 * Qué pasó, para poder medirlo:
 *  · `empujado`   → la web aceptó el empujón (2xx).
 *  · `no_es_gol`  → el evento no era un gol; no se llamó a nadie.
 *  · `sin_camino` → falta `EXPO_PUBLIC_WEB_URL` o no hay sesión: no se puede llamar.
 *  · `fallo`      → se llamó y no salió (HTTP no-2xx, red caída). El cron lo recoge.
 */
export type NudgeOutcome = 'empujado' | 'no_es_gol' | 'sin_camino' | 'fallo';

/**
 * `row` es la fila de `match_events` que se acaba de subir. El predicado es el MISMO
 * que la cláusula WHEN del trigger `notify_goal` (`isMatchGoal`, en core): si los dos
 * no coinciden, o se empuja un evento que no creó filas o se deja un gol sin empujar.
 */
export async function nudgeGoalPush(
  row: { id: string; type: string; metadata?: { outcome?: string } | null },
  call: NudgeCaller,
): Promise<NudgeOutcome> {
  if (!isMatchGoal({ type: row.type, outcome: row.metadata?.outcome ?? null })) {
    return 'no_es_gol';
  }
  try {
    const res = await call(GOAL_PUSH_PATH, {
      method: 'POST',
      body: { goalRowId: row.id },
    });
    return res.ok ? 'empujado' : 'fallo';
  } catch (e) {
    // `callServerEndpoint` lanza con estos dos mensajes cuando no hay por dónde
    // llamar; no es un fallo del envío, es que no había camino.
    const msg = e instanceof Error ? e.message : '';
    return msg === 'no_web_url' || msg === 'no_session' ? 'sin_camino' : 'fallo';
  }
}
