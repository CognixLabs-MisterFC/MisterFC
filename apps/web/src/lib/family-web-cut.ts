import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
  evaluateFamilyWebCutFromClient,
  type Database,
  type FamilyWebCutDecision,
} from '@misterfc/core';

/**
 * W-B — envoltorio web del corte de la web para familias. Mismo patrón que
 * `subscription-gate.ts`: la DECISIÓN vive en core (W-A), que es donde hay tests; aquí
 * solo se inyecta el interruptor y el aviso a Sentry.
 *
 * ⚠️ SE ENVÍA APAGADO. Solo cierra si `FAMILY_WEB_CUT` vale exactamente `'on'`.
 *
 * Y a diferencia del gate de suscripción, aquí el interruptor es **UNO SOLO y solo de
 * la web** (decisión 4 de Jose). Aquel son dos variables que tienen que encenderse
 * juntas porque son las dos mitades de un mismo muro; este no: la app es el DESTINO del
 * corte, no la otra mitad. La app no se entera de nada.
 */
export const FAMILY_WEB_CUT_ENABLED = process.env.FAMILY_WEB_CUT === 'on';

export async function evaluateFamilyWebCut(
  supabase: SupabaseClient<Database>,
): Promise<FamilyWebCutDecision> {
  return evaluateFamilyWebCutFromClient(supabase, {
    enabled: FAMILY_WEB_CUT_ENABLED,
    onUnreadable: (raw) => {
      Sentry.captureMessage('family-web-cut: no se pudo leer quien es en el corte web', {
        level: 'warning',
        tags: { feature: 'family_web_cut', step: 'cut_web' },
        extra: { raw: String(raw) },
      });
    },
  });
}

/**
 * Enlaces de descarga. **Hoy los dos son `null` a propósito**: la app no está publicada,
 * así que no hay URL que poner (decisión 3 de Jose: «se escriben cuando existan; monta
 * la página ahora sin ellas»).
 *
 * Mientras valgan `null`, la página enseña la instrucción de buscar la app por su nombre
 * en la tienda. En cuanto se pegue una URL aquí, el botón correspondiente aparece solo:
 * no hay nada más que tocar. Se prefiere esto a un enlace muerto, que es peor que no
 * tener enlace — un enlace que no lleva a ninguna parte parece una avería.
 */
export const APP_STORE_URL: string | null = null;
export const PLAY_STORE_URL: string | null = null;
