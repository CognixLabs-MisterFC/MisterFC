import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SU-4 — CANDADO del `logOut()` del SDK en el camino de borrado de cuenta.
 *
 * ADR-0022 §4b: sin esa llamada el SDK conserva cacheado el App User ID de la cuenta
 * borrada en ESE dispositivo, y el siguiente "restaurar compras" vuelve a asociar la
 * compra al perfil anonimizado. Es el agujero que está en nuestra app, no en la capa de
 * RevenueCat, y las otras tres piezas del antídoto no lo tapan.
 *
 * Es una comprobación ESTÁTICA sobre el fichero, y conviene decir por qué: el runner de
 * la nativa es vitest en entorno Node sobre lógica pura (`include: src/**\/*.test.ts`),
 * sin runtime de React Native, así que no se puede renderizar la tarjeta y pulsar el
 * botón. Lo que sí se puede garantizar es que la línea no desaparezca en un refactor
 * —que es exactamente cómo se perdería— y en qué ORDEN está.
 *
 * La alternativa sería no comprobar nada, y esta pieza falla en silencio: nadie se
 * entera hasta que una compra reaparece en una cuenta borrada.
 */
// Rutas desde el cwd (vitest corre en `apps/native`) y NO con `new URL`: el tsconfig de
// la app trae los libs de DOM, así que `URL` resuelve al tipo del DOM y `readFileSync`
// lo rechaza en typecheck. Mismo criterio que el alias de `vitest.config.ts`.
const CARD = join(process.cwd(), 'src/ui/delete-account-card.tsx');
const CONTEXT = join(process.cwd(), 'src/auth/context.tsx');

function source(): string {
  return readFileSync(CARD, 'utf8');
}

describe('el borrado de cuenta cierra la sesión del SDK', () => {
  it('la tarjeta importa logOutPurchases', () => {
    expect(source()).toMatch(
      /import\s*\{\s*logOutPurchases\s*\}\s*from\s*'@\/subscription\/purchases'/,
    );
  });

  it('y la llama', () => {
    expect(source()).toMatch(/await\s+logOutPurchases\(\)/);
  });

  /**
   * El orden importa: `signOut` desmonta la pantalla, así que un `await` posterior
   * podría no llegar a ejecutarse nunca.
   */
  it('la llama ANTES del signOut de Supabase', () => {
    const src = source();
    const logOut = src.indexOf('await logOutPurchases()');
    const signOut = src.indexOf('await signOut()');
    expect(logOut).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(-1);
    expect(logOut).toBeLessThan(signOut);
  });

  /**
   * Y está en la rama de la cuenta YA anonimizada, no en la de "queda pendiente": ahí NO
   * se cierra sesión (sin ella la pantalla de estado y el botón de cancelar serían
   * inalcanzables), así que tampoco toca cerrar el SDK.
   */
  it('está en la rama de la cuenta ya anonimizada', () => {
    const src = source();
    const branch = src.indexOf('if (anonymized)');
    const logOut = src.indexOf('await logOutPurchases()');
    const nextReturn = src.indexOf('return;', logOut);
    expect(branch).toBeGreaterThan(-1);
    expect(logOut).toBeGreaterThan(branch);
    expect(nextReturn).toBeGreaterThan(logOut);
  });
});

/**
 * Y el mismo cierre en el `signOut` normal: en un móvil COMPARTIDO, si el SDK sigue
 * presentando el App User ID de quien acaba de salir, un "restaurar compras" de la
 * siguiente persona podría mover la compra a su cuenta.
 */
describe('cerrar sesión también cierra el SDK', () => {
  it('el contexto de la app llama a logOutPurchases', () => {
    const src = readFileSync(CONTEXT, 'utf8');
    expect(src).toMatch(/await\s+logOutPurchases\(\)/);
  });
});
