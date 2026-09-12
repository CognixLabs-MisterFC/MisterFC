import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREMIUM_ENTITLEMENT_ID,
  billingIssueAfterReconcile,
  projectRevenueCatSubscriber,
} from '../subscriber';

/**
 * SU-6b — la proyección de lo que responde `GET /subscribers`.
 *
 * Los tres casos que de verdad importan aquí salieron de leer su documentación viva, no
 * de imaginar payloads: el `is_sandbox` (que si no se mira abre producción con una
 * compra de TestFlight), el `store` en minúsculas (misma columna que el webhook escribe
 * en mayúsculas) y `billing_issues_detected_at`, que vuelve null aunque haya impago.
 */

const PRODUCT = 'com.misterfc.app.suscripcion.anual';
const PROFILE = '11111111-1111-4111-8111-111111111111';

function subscriber(over: {
  entitlement?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
} = {}) {
  const entitlement =
    over.entitlement === undefined
      ? {
          expires_date: '2027-09-12T10:00:00Z',
          grace_period_expires_date: null,
          product_identifier: PRODUCT,
          purchase_date: '2026-09-12T10:00:00Z',
        }
      : over.entitlement;
  const subscription =
    over.subscription === undefined
      ? {
          expires_date: '2027-09-12T10:00:00Z',
          grace_period_expires_date: null,
          billing_issues_detected_at: null,
          is_sandbox: false,
          store: 'app_store',
          store_transaction_id: '1000000123456789',
          unsubscribe_detected_at: null,
          period_type: 'normal',
        }
      : over.subscription;

  return {
    request_date: '2026-09-12T11:00:00Z',
    subscriber: {
      original_app_user_id: PROFILE,
      entitlements: entitlement ? { [PREMIUM_ENTITLEMENT_ID]: entitlement } : {},
      subscriptions: subscription ? { [PRODUCT]: subscription } : {},
    },
  };
}

describe('projectRevenueCatSubscriber', () => {
  it('proyecta una suscripción sana', () => {
    const p = projectRevenueCatSubscriber(subscriber());
    expect(p).toMatchObject({
      entitled: true,
      sandbox: false,
      expiresAt: '2027-09-12T10:00:00.000Z',
      gracePeriodExpiresAt: null,
      billingIssueAt: null,
      productId: PRODUCT,
      storeTransactionId: '1000000123456789',
      rcCustomerId: PROFILE,
    });
  });

  // La REST manda `app_store`; el webhook manda `APP_STORE`. Es la MISMA columna.
  it('normaliza la tienda a mayúsculas, como la manda el webhook', () => {
    expect(projectRevenueCatSubscriber(subscriber())?.store).toBe('APP_STORE');
    const play = projectRevenueCatSubscriber(
      subscriber({ subscription: { store: 'play_store', is_sandbox: false } }),
    );
    expect(play?.store).toBe('PLAY_STORE');
  });

  // Sin esto, una compra de TestFlight abriría producción por esta vía — justo lo que
  // `apply_subscription_event` rechaza en el camino del webhook.
  it('marca sandbox', () => {
    const p = projectRevenueCatSubscriber(
      subscriber({ subscription: { is_sandbox: true, store: 'app_store' } }),
    );
    expect(p?.sandbox).toBe(true);
  });

  it('sin entitlement PREMIUM no hay nada que aplicar', () => {
    const p = projectRevenueCatSubscriber(subscriber({ entitlement: null }));
    expect(p).toMatchObject({
      entitled: false,
      expiresAt: null,
      gracePeriodExpiresAt: null,
      store: null,
      productId: null,
      rcCustomerId: PROFILE,
    });
  });

  it('la gracia vale venga del entitlement o de la suscripción, y se queda la más lejana', () => {
    const soloSub = projectRevenueCatSubscriber(
      subscriber({
        subscription: { grace_period_expires_date: '2026-09-20T10:00:00Z', is_sandbox: false },
      }),
    );
    expect(soloSub?.gracePeriodExpiresAt).toBe('2026-09-20T10:00:00.000Z');

    const ambas = projectRevenueCatSubscriber(
      subscriber({
        entitlement: {
          expires_date: '2026-09-12T10:00:00Z',
          grace_period_expires_date: '2026-09-18T10:00:00Z',
          product_identifier: PRODUCT,
        },
        subscription: { grace_period_expires_date: '2026-09-22T10:00:00Z', is_sandbox: false },
      }),
    );
    expect(ambas?.gracePeriodExpiresAt).toBe('2026-09-22T10:00:00.000Z');
  });

  it('si el entitlement no trae vencimiento, se cae al de la suscripción', () => {
    const p = projectRevenueCatSubscriber(
      subscriber({
        entitlement: { expires_date: null, product_identifier: PRODUCT },
        subscription: { expires_date: '2027-01-01T00:00:00Z', is_sandbox: false },
      }),
    );
    expect(p?.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  // El día que RevenueCat arregle su endpoint, esto se queda quieto y funciona.
  it('si la API devolviera el impago, se propaga', () => {
    const p = projectRevenueCatSubscriber(
      subscriber({
        subscription: { billing_issues_detected_at: '2026-09-01T08:00:00Z', is_sandbox: false },
      }),
    );
    expect(p?.billingIssueAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('se proyecta la baja de la renovación automática aunque hoy no haya dónde guardarla', () => {
    const p = projectRevenueCatSubscriber(
      subscriber({
        subscription: { unsubscribe_detected_at: '2026-09-05T08:00:00Z', is_sandbox: false },
      }),
    );
    expect(p?.unsubscribeDetectedAt).toBe('2026-09-05T08:00:00.000Z');
  });

  it.each([null, undefined, 42, 'texto', {}, { subscriber: 'no' }, []])(
    'una respuesta que no se entiende devuelve null (%p)',
    (body) => {
      expect(projectRevenueCatSubscriber(body)).toBeNull();
    },
  );

  it('una fecha ilegible no se cuela como fecha', () => {
    const p = projectRevenueCatSubscriber(
      subscriber({ entitlement: { expires_date: 'mañana', product_identifier: PRODUCT } }),
    );
    // Cae al de la suscripción, que sí es legible.
    expect(p?.expiresAt).toBe('2027-09-12T10:00:00.000Z');
  });
});

/**
 * La regla del impago. Existe porque `billing_issues_detected_at` vuelve NULL aunque el
 * cliente tenga uno (reconocido por RevenueCat en su foro, 15-11-2024, sin resolver):
 * copiarlo tal cual borraría el impago de todas las cuentas en la primera pasada
 * nocturna, y con él la prioridad de la lista de candidatos.
 */
describe('billingIssueAfterReconcile', () => {
  const now = new Date('2026-09-12T12:00:00Z');

  it('si la API lo dice, manda la API', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: '2026-09-10T00:00:00Z',
        stored: '2026-08-01T00:00:00Z',
        gracePeriodExpiresAt: null,
        expiresAt: '2027-01-01T00:00:00Z',
        now,
      }),
    ).toBe('2026-09-10T00:00:00Z');
  });

  it('con gracia abierta y nada guardado, se sella ahora', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: null,
        stored: null,
        gracePeriodExpiresAt: '2026-09-20T00:00:00Z',
        expiresAt: '2026-09-10T00:00:00Z',
        now,
      }),
    ).toBe(now.toISOString());
  });

  // Lo que NO puede pasar: que la fecha se empuje un día hacia delante cada noche y la
  // columna acabe diciendo "detectado hoy" de un impago de hace tres semanas.
  it('con gracia abierta se CONSERVA la fecha que ya teníamos', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: null,
        stored: '2026-08-20T09:00:00Z',
        gracePeriodExpiresAt: '2026-09-20T00:00:00Z',
        expiresAt: '2026-09-10T00:00:00Z',
        now,
      }),
    ).toBe('2026-08-20T09:00:00Z');
  });

  // El único caso en que se limpia: renovó de verdad.
  it('sin gracia y con el vencimiento en el futuro, se limpia', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: null,
        stored: '2026-08-20T09:00:00Z',
        gracePeriodExpiresAt: null,
        expiresAt: '2027-09-12T00:00:00Z',
        now,
      }),
    ).toBeNull();
  });

  it('vencida y con la gracia ya pasada, se conserva el impago', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: null,
        stored: '2026-08-20T09:00:00Z',
        gracePeriodExpiresAt: '2026-09-05T00:00:00Z',
        expiresAt: '2026-09-01T00:00:00Z',
        now,
      }),
    ).toBe('2026-08-20T09:00:00Z');
  });

  it('sin nada que decir, no se inventa un impago', () => {
    expect(
      billingIssueAfterReconcile({
        fromApi: null,
        stored: null,
        gracePeriodExpiresAt: null,
        expiresAt: null,
        now,
      }),
    ).toBeNull();
  });
});

/**
 * CONTRATO con la nativa. `purchases.ts` no puede importar de core (hay un test de SU-4
 * que lo exige, para que el bundle de Metro no arrastre el módulo de servidor), así que
 * el literal del entitlement está escrito dos veces. Lo que ata los dos sitios es esto:
 * si alguien cambia uno, salta aquí.
 */
describe('contrato del entitlement con la app nativa', () => {
  function readFromRepo(relative: string): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(dir, relative);
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`no encuentro ${relative} subiendo desde ${process.cwd()}`);
  }

  it('PREMIUM_ENTITLEMENT_ID es el mismo literal que usa purchases.ts', () => {
    const src = readFromRepo('apps/native/src/subscription/purchases.ts');
    const match = /ENTITLEMENT_ID\s*=\s*'([^']+)'/.exec(src);
    expect(match?.[1], 'no encuentro ENTITLEMENT_ID en purchases.ts').toBeDefined();
    expect(match?.[1]).toBe(PREMIUM_ENTITLEMENT_ID);
  });
});
