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
 * Enlaces de descarga. **Las dos apps están publicadas desde octubre de 2026**, así que
 * aquí ya hay URL y la página enseña los dos botones. Nacieron en `null` a propósito
 * (decisión 3 de Jose: «se escriben cuando existan; monta la página ahora sin ellas»)
 * porque un enlace muerto es peor que no tener enlace: el que no lleva a ninguna parte
 * parece una avería.
 *
 * El tipo sigue siendo `string | null` y eso NO es residuo. `aplicacion/page.tsx` filtra
 * los nulos y, si no queda ninguno, enseña `download_soon` en vez de los botones. Es la
 * salida para el día en que una tienda retire la ficha o haya que despublicar: se pone
 * esa constante en `null` y la página se adapta sola, sin tocar nada más. Por eso
 * tampoco se retira la cadena `download_soon`, que hoy no se ve.
 *
 * Comprobadas en vivo antes de pegarlas (2026-10-06): las dos dan 200; la de Apple
 * titula «App MisterFC - App Store» y la de Play sirve la ficha de verdad —no una
 * página de "no encontrado", que Google también devuelve con 200—.
 *
 * El identificador de Play es el `applicationId` del build (`com.misterfc.app`), el
 * mismo de `app.json`; el de Apple es el ID numérico que asigna App Store Connect y no
 * se puede deducir del repo.
 */
export const APP_STORE_URL: string | null =
  'https://apps.apple.com/es/app/misterfc/id6810337932';
export const PLAY_STORE_URL: string | null =
  'https://play.google.com/store/apps/details?id=com.misterfc.app';
