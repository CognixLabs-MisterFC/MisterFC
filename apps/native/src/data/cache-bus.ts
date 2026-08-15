import { cacheClear } from '@misterfc/core';
import { secureCacheBacking } from './secure-cache-backing';

/**
 * O2 — Bus CENTRAL de invalidación de la caché de lectura, POR RECURSO.
 *
 * Tras una ESCRITURA, la pantalla llama a `invalidateResources([...])` (a través
 * del mapa documentado en `cache-resources.ts`, nunca a mano). Para cada recurso:
 *
 *   1) Se BORRA de secure-store toda cache-key CONOCIDA que empiece por ese
 *      recurso → una navegación FRÍA posterior (pantalla no montada) hará
 *      block-fetch fresco, sin flash de datos viejos.
 *   2) Se NOTIFICA a los `useCached` MONTADOS con key coincidente para que
 *      recarguen de inmediato, sin esperar al re-foco.
 *
 * Una cache-key tiene forma `<recurso>.<...>` (p.ej. `inicio.<club>.<tutor>` o
 * `home.<club>.<team>`), así que "casa el recurso R" ≡ `key === R` o
 * `key.startsWith(R + '.')` — así `inicio` no colisiona con `inicio-otra-cosa` ni
 * `convocatoria` con `convocatorias`.
 *
 * ALCANCE: la notificación es EN PROCESO (esta instancia de la app). Sirve para
 * que unas pantallas no muestren lo que otra acaba de cambiar en el MISMO
 * dispositivo. La frescura entre dispositivos distintos depende del polling
 * (directo) o del refetch-al-enfocar, no de este bus.
 */
type Subscriber = { key: string; onInvalidate: () => void };

const subscribers = new Set<Subscriber>();
const knownKeys = new Set<string>();

function keyMatchesResource(key: string, resource: string): boolean {
  return key === resource || key.startsWith(`${resource}.`);
}

/**
 * Suscribe un `useCached` (por su key exacta) a las invalidaciones que le afecten.
 * Registra además la key como "conocida" para que una invalidación pueda limpiarla
 * de secure-store aunque la pantalla no esté montada. Devuelve el de-suscriptor.
 */
export function subscribeInvalidation(key: string, onInvalidate: () => void): () => void {
  const sub: Subscriber = { key, onInvalidate };
  subscribers.add(sub);
  knownKeys.add(key);
  return () => {
    subscribers.delete(sub);
  };
}

/**
 * Invalida uno o varios recursos: limpia secure-store (keys conocidas que casen) y
 * dispara la recarga de los `useCached` montados que casen. Fire-and-forget desde
 * los call-sites de escritura (la limpieza es asíncrona).
 */
export async function invalidateResources(resources: readonly string[]): Promise<void> {
  const clears: Promise<void>[] = [];
  for (const key of knownKeys) {
    if (resources.some((r) => keyMatchesResource(key, r))) {
      clears.push(cacheClear(secureCacheBacking, key));
    }
  }
  await Promise.all(clears);

  for (const sub of subscribers) {
    if (resources.some((r) => keyMatchesResource(sub.key, r))) {
      sub.onInvalidate();
    }
  }
}

/** Solo para tests: reinicia suscriptores y keys conocidas. */
export function __resetCacheBusForTests(): void {
  subscribers.clear();
  knownKeys.clear();
}
