import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { evaluateSubscriptionGateFromClient } from '../gate';

function makeClient(resp: { data?: unknown; error?: unknown }, calls?: string[]) {
  return {
    rpc: (name: string) => {
      calls?.push(name);
      return Promise.resolve(resp);
    },
  } as unknown as SupabaseClient<Database>;
}

const row = (o: Record<string, unknown> = {}) => ({
  requires_subscription: true,
  has_access: true,
  state: 'active',
  access_until: '2099-01-01T00:00:00Z',
  billing_issue: false,
  ...o,
});

const on = { enabled: true };

describe('evaluateSubscriptionGateFromClient', () => {
  it('con el interruptor APAGADO no bloquea y NI PREGUNTA', async () => {
    const calls: string[] = [];
    const res = await evaluateSubscriptionGateFromClient(makeClient({ data: [row()] }, calls), {
      enabled: false,
    });
    expect(res).toEqual({ blocked: false, status: null, reason: 'gate_off' });
    // No gastar una RPC por render cuando el gate no está en uso.
    expect(calls).toEqual([]);
  });

  // El caso que pondría el muro a quien ha pagado.
  it('si la lectura falla NO bloquea, y avisa', async () => {
    const seen: unknown[] = [];
    const res = await evaluateSubscriptionGateFromClient(makeClient({ error: { message: 'x' } }), {
      ...on,
      onUnreadable: (raw) => seen.push(raw),
    });
    expect(res).toMatchObject({ blocked: false, reason: 'unreadable' });
    expect(seen).toHaveLength(1);
  });

  it('cero filas también es ilegible, no "no tiene"', async () => {
    const res = await evaluateSubscriptionGateFromClient(makeClient({ data: [] }), on);
    expect(res).toMatchObject({ blocked: false, reason: 'unreadable' });
  });

  it('quien no paga pasa', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({
        data: [row({ requires_subscription: false, state: 'staff_free', access_until: null })],
      }),
      on,
    );
    expect(res).toMatchObject({ blocked: false, reason: 'not_required' });
  });

  it('quien paga y está al día pasa', async () => {
    const res = await evaluateSubscriptionGateFromClient(makeClient({ data: [row()] }), on);
    expect(res).toMatchObject({ blocked: false, reason: 'has_access' });
  });

  it('la gracia DA acceso', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({ data: [row({ state: 'grace', billing_issue: true })] }),
      on,
    );
    expect(res).toMatchObject({ blocked: false, reason: 'has_access' });
  });

  it('sin suscripción bloquea', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({ data: [row({ has_access: false, state: 'none', access_until: null })] }),
      on,
    );
    expect(res.blocked).toBe(true);
  });

  it('vencida bloquea', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({
        data: [row({ has_access: false, state: 'expired', access_until: '2020-01-01T00:00:00Z' })],
      }),
      on,
    );
    expect(res.blocked).toBe(true);
  });

  // `applyClock` cierra la ventana entre el cálculo del servidor y este render: el SQL
  // dijo que tenía acceso, pero la fecha ya pasó.
  it('una fecha ya pasada bloquea aunque el servidor dijera que hay acceso', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({
        data: [row({ has_access: true, state: 'active', access_until: '2020-01-01T00:00:00Z' })],
      }),
      on,
    );
    expect(res.blocked).toBe(true);
  });

  it('una cuenta desenganchada por borrado bloquea', async () => {
    const res = await evaluateSubscriptionGateFromClient(
      makeClient({ data: [row({ has_access: false, state: 'unlinked', access_until: null })] }),
      on,
    );
    expect(res.blocked).toBe(true);
  });
});

/**
 * CENSO de los puntos comunes de la web.
 *
 * El fallo que se quiere impedir es el que avisó Jose: `/spectator` es HERMANA de
 * `(authenticated)`, no cuelga de su layout, así que un gate puesto solo allí deja el
 * árbol del seguidor abierto de par en par — y los seguidores pagan. No es hipotético:
 * es el mismo patrón por el que BC-3 dejó el borrado sin rematar al engancharlo en los
 * callers en vez de en el punto común.
 *
 * Por eso esto no comprueba "los dos que conozco", sino TODOS los layouts de primer
 * nivel: uno nuevo entra en rojo hasta que alguien decida, a mano, si lleva gate.
 */
describe('censo: todo layout autenticado pasa por el gate', () => {
  /** Layouts que NO llevan gate, y por qué. Añadir aquí es una DECISIÓN, no un olvido. */
  const EXEMPT: Record<string, string> = {
    'layout.tsx': 'raíz de locale: envuelve también signin, invite y las páginas públicas',
    'legal/layout.tsx': 'los textos legales son públicos y deben verse SIN sesión',
    'platform/layout.tsx': 'consola de superadmin: no es familia y no paga (requires_subscription=false)',
  };

  function repoRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(join(dir, 'apps/web/src/app'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`no encuentro apps/web subiendo desde ${process.cwd()}`);
  }

  function layouts(): { rel: string; src: string }[] {
    const base = join(repoRoot(), 'apps/web/src/app/[locale]');
    const out: { rel: string; src: string }[] = [];
    const root = join(base, 'layout.tsx');
    if (existsSync(root)) out.push({ rel: 'layout.tsx', src: readFileSync(root, 'utf8') });
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry);
      if (!statSync(dir).isDirectory()) continue;
      const file = join(dir, 'layout.tsx');
      if (existsSync(file)) out.push({ rel: `${entry}/layout.tsx`, src: readFileSync(file, 'utf8') });
    }
    return out;
  }

  it('encuentra los layouts (si no, el censo no vigila nada)', () => {
    const found = layouts().map((l) => l.rel);
    expect(found).toContain('(authenticated)/layout.tsx');
    expect(found).toContain('spectator/layout.tsx');
  });

  it('cada layout o llama al gate o está exento con motivo', () => {
    for (const { rel, src } of layouts()) {
      const gated = src.includes('evaluateSubscriptionGate');
      const exemptReason = EXEMPT[rel];
      expect(
        gated || exemptReason !== undefined,
        `${rel} no llama al gate y no está en EXEMPT: decide y anótalo`,
      ).toBe(true);
      // Y al contrario: si está exento, que no lo llame (señal de lista rancia).
      if (exemptReason !== undefined) {
        expect(gated, `${rel} está en EXEMPT pero SÍ llama al gate`).toBe(false);
      }
    }
  });

  it('los dos puntos que importan están gateados', () => {
    const byRel = new Map(layouts().map((l) => [l.rel, l.src]));
    expect(byRel.get('(authenticated)/layout.tsx')).toContain('evaluateSubscriptionGate');
    expect(byRel.get('spectator/layout.tsx')).toContain('evaluateSubscriptionGate');
  });

  it('el muro NO cuelga de ninguno de los layouts que redirigen a él', () => {
    const paywall = join(repoRoot(), 'apps/web/src/app/[locale]/suscripcion/page.tsx');
    expect(existsSync(paywall), 'falta la pantalla del muro').toBe(true);
    // Vive como hermana de (authenticated) y de spectator: si estuviera dentro de
    // cualquiera de los dos, el redirect del layout la volvería a interceptar.
    expect(
      existsSync(join(repoRoot(), 'apps/web/src/app/[locale]/(authenticated)/suscripcion')),
    ).toBe(false);
    expect(
      existsSync(join(repoRoot(), 'apps/web/src/app/[locale]/spectator/suscripcion')),
    ).toBe(false);
  });

  it('el muro lleva la tarjeta de borrar la cuenta (Apple 5.1.1 v)', () => {
    const src = readFileSync(
      join(repoRoot(), 'apps/web/src/app/[locale]/suscripcion/page.tsx'),
      'utf8',
    );
    expect(src).toContain('DeleteAccountCard');
  });
});
