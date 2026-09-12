import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * SU-6b — la reclamación desde la app.
 *
 * Dos cosas distintas se comprueban aquí:
 *
 *  1. Que `claimSubscription` NO lance nunca. Se llama en el peor momento posible —una
 *     compra que ya ha ido rara— y cualquier excepción dejaría al usuario mirando un
 *     spinner en vez del mensaje honesto del muro. `callServerEndpoint` lanza de verdad
 *     (`no_web_url` si el operador no configuró el dominio, `no_session` sin sesión).
 *
 *  2. Que el MURO la llame. Es una comprobación estática sobre el fichero, igual que el
 *     candado del `logOut()` de SU-4 y por el mismo motivo: el runner de la nativa es
 *     vitest en Node sobre lógica pura, sin runtime de React Native, así que no se puede
 *     renderizar la pantalla y pulsar. Lo que sí se garantiza es que la llamada no
 *     desaparezca en un refactor — que es exactamente cómo se perdería, y en silencio:
 *     el muro seguiría funcionando, solo que la familia que pagó se quedaría fuera.
 */

const { callServerEndpoint } = vi.hoisted(() => ({ callServerEndpoint: vi.fn() }));

vi.mock('@/lib/server-api', () => ({ callServerEndpoint }));

afterEach(() => {
  callServerEndpoint.mockReset();
});

async function claim() {
  const mod = await import('./claim');
  return mod.claimSubscription();
}

describe('claimSubscription', () => {
  it('devuelve el desenlace que da el servidor', async () => {
    callServerEndpoint.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcome: 'claimed' }), { status: 200 }),
    );
    await expect(claim()).resolves.toEqual({ ok: true, outcome: 'claimed' });
    expect(callServerEndpoint).toHaveBeenCalledWith('/api/subscription/claim', {
      method: 'POST',
    });
  });

  it('"no tienes compra" llega tal cual para poder decirlo en pantalla', async () => {
    callServerEndpoint.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcome: 'no_entitlement' }), { status: 200 }),
    );
    await expect(claim()).resolves.toEqual({ ok: true, outcome: 'no_entitlement' });
  });

  it('un 500 no se disfraza de éxito', async () => {
    callServerEndpoint.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(claim()).resolves.toEqual({ ok: false, outcome: null });
  });

  it('un 401 tampoco', async () => {
    callServerEndpoint.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(claim()).resolves.toEqual({ ok: false, outcome: null });
  });

  // Sin `EXPO_PUBLIC_WEB_URL` configurada, `callServerEndpoint` LANZA. Que eso llegue al
  // muro como una excepción sería un spinner infinito.
  it.each(['no_web_url', 'no_session'])('%s no lanza: se trata como "no ha podido ser"', async (
    message,
  ) => {
    callServerEndpoint.mockRejectedValue(new Error(message));
    await expect(claim()).resolves.toEqual({ ok: false, outcome: null });
  });

  it('un cuerpo que no es JSON tampoco lanza', async () => {
    callServerEndpoint.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(claim()).resolves.toEqual({ ok: false, outcome: null });
  });

  it('un cuerpo sin ok no se cuenta como reclamado', async () => {
    callServerEndpoint.mockResolvedValue(
      new Response(JSON.stringify({ outcome: 'claimed' }), { status: 200 }),
    );
    await expect(claim()).resolves.toEqual({ ok: false, outcome: 'claimed' });
  });
});

describe('el muro reclama cuando el servidor no ha visto la compra', () => {
  const source = () => readFileSync(join(process.cwd(), 'src/subscription/paywall.tsx'), 'utf8');

  it('el muro importa claimSubscription', () => {
    expect(source()).toMatch(
      /import\s*\{\s*claimSubscription\s*\}\s*from\s*'@\/subscription\/claim'/,
    );
  });

  /**
   * Y la llama DESPUÉS de esperar, no antes: primero se le da al webhook su tiempo (es el
   * camino normal y no gasta una llamada REST), y solo si no llega se reclama.
   */
  it('la llama después de esperar al webhook', () => {
    const src = source();
    const wait = src.indexOf('await waitForEntitlement()');
    const claimCall = src.indexOf('await claimSubscription()');
    expect(wait).toBeGreaterThan(-1);
    expect(claimCall).toBeGreaterThan(wait);
  });

  /**
   * Los DOS botones que pueden acabar en un acceso pendiente —comprar y restaurar— pasan
   * por `activate()`, que es donde vive la reclamación. Si alguno se saltara ese punto
   * común, el que se quedaría sin rescate es justo el de "Restaurar compras", que es el
   * botón que pulsa quien ya ha pagado.
   */
  it('comprar y restaurar pasan los dos por activate()', () => {
    const src = source();
    const buy = src.slice(src.indexOf('const onBuy'), src.indexOf('const onRestore'));
    const restore = src.slice(src.indexOf('const onRestore'), src.indexOf('const activate'));
    expect(buy).toContain('await activate()');
    expect(restore).toContain('await activate()');
  });

  it('si no hay compra se dice, no se deja el mensaje de "está tardando"', () => {
    expect(source()).toMatch(/no_entitlement.*claim_none/s);
  });
});
