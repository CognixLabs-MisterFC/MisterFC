import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SU-4 — el envoltorio del SDK de RevenueCat.
 *
 * Lo que se protege aquí son las tres cosas que no se pueden caer, y ninguna da la
 * cara cuando se rompe: un App User ID equivocado, un `logOut` que no se llama, y un
 * "restaurar compras" que se convierte en un permiso. Las tres fallan en silencio.
 *
 * `react-native-purchases` y `react-native` son módulos nativos: se sustituyen por
 * espías para poder cargar el módulo bajo test en entorno Node (mismo patrón que
 * `public-clubs.test`).
 */
const { calls, platform, offerings, throwOnLogOut, purchaseInfo, purchaseThrows } =
  vi.hoisted(() => ({
    calls: [] as { fn: string; arg?: unknown }[],
    platform: { os: 'ios' as 'ios' | 'android' },
    offerings: { value: null as unknown },
    throwOnLogOut: { value: false },
    purchaseInfo: { entitled: true },
    purchaseThrows: { value: null as unknown },
  }));

const infoFor = (entitled: boolean) => ({
  entitlements: { active: entitled ? { PREMIUM: { isActive: true } } : {} },
});

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platform.os;
    },
  },
}));

vi.mock('react-native-purchases', () => ({
  LOG_LEVEL: { WARN: 'WARN' },
  default: {
    setLogLevel: (l: unknown) => calls.push({ fn: 'setLogLevel', arg: l }),
    configure: (c: unknown) => calls.push({ fn: 'configure', arg: c }),
    logIn: async (id: string) => {
      calls.push({ fn: 'logIn', arg: id });
      return { customerInfo: infoFor(true), created: false };
    },
    logOut: async () => {
      calls.push({ fn: 'logOut' });
      if (throwOnLogOut.value) throw new Error('ya es anónimo');
      return infoFor(false);
    },
    getOfferings: async () => {
      calls.push({ fn: 'getOfferings' });
      if (offerings.value instanceof Error) throw offerings.value;
      return offerings.value;
    },
    purchasePackage: async (p: unknown) => {
      calls.push({ fn: 'purchasePackage', arg: p });
      if (purchaseThrows.value !== null) throw purchaseThrows.value;
      return { customerInfo: infoFor(purchaseInfo.entitled) };
    },
    restorePurchases: async () => {
      calls.push({ fn: 'restorePurchases' });
      return infoFor(purchaseInfo.entitled);
    },
  },
}));

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

async function load() {
  vi.resetModules();
  return import('./purchases');
}

beforeEach(() => {
  calls.length = 0;
  platform.os = 'ios';
  offerings.value = null;
  throwOnLogOut.value = false;
  purchaseInfo.entitled = true;
  purchaseThrows.value = null;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
});

describe('los identificadores del proyecto', () => {
  // Un identificador mal escrito NO da error: devuelve "no tiene acceso" en silencio,
  // y desde el otro lado parece que la compra no funcionó.
  it('son exactamente los que dio Jose', async () => {
    const m = await load();
    expect(m.ENTITLEMENT_ID).toBe('PREMIUM');
    expect(m.OFFERING_ID).toBe('default_misterfc');
    expect(m.ANNUAL_PRODUCT_ID).toBe('com.misterfc.app.suscripcion.anual');
  });

  it('el entitlement va en MAYÚSCULAS', async () => {
    const m = await load();
    expect(m.ENTITLEMENT_ID).toBe(m.ENTITLEMENT_ID.toUpperCase());
  });
});

describe('canPurchase', () => {
  it('en iOS, con clave, se puede cobrar', async () => {
    const m = await load();
    expect(m.canPurchase()).toBe(true);
  });

  // Play no está configurado: sin clave no se ofrece un botón que no puede funcionar.
  it('en Android, sin clave, NO se puede cobrar', async () => {
    platform.os = 'android';
    const m = await load();
    expect(m.canPurchase()).toBe(false);
  });

  it('en Android con su clave, sí', async () => {
    platform.os = 'android';
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_test';
    const m = await load();
    expect(m.canPurchase()).toBe(true);
  });

  it('cada plataforma usa SU clave, no la de la otra', async () => {
    platform.os = 'android';
    const m = await load();
    // Solo está la de iOS: en Android no debe colarse.
    expect(m.canPurchase()).toBe(false);
  });
});

describe('el App User ID es nuestro profiles.id', () => {
  it('se configura con el profileId, nunca con el anónimo del SDK', async () => {
    const m = await load();
    expect(await m.configurePurchases(PROFILE)).toBe(true);
    const configure = calls.find((c) => c.fn === 'configure');
    expect(configure?.arg).toMatchObject({ appUserID: PROFILE, apiKey: 'appl_test' });
  });

  it('no se vuelve a configurar para la misma persona', async () => {
    const m = await load();
    await m.configurePurchases(PROFILE);
    await m.configurePurchases(PROFILE);
    expect(calls.filter((c) => c.fn === 'configure')).toHaveLength(1);
    expect(calls.filter((c) => c.fn === 'logIn')).toHaveLength(0);
  });

  it('si cambia la persona se hace logIn, no otro configure', async () => {
    const m = await load();
    await m.configurePurchases(PROFILE);
    await m.configurePurchases(OTHER);
    expect(calls.filter((c) => c.fn === 'configure')).toHaveLength(1);
    expect(calls.find((c) => c.fn === 'logIn')?.arg).toBe(OTHER);
  });

  it('sin clave de plataforma NO se configura nada', async () => {
    platform.os = 'android';
    const m = await load();
    expect(await m.configurePurchases(PROFILE)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

/**
 * ADR-0022 §4b. Sin este `logOut` el SDK conserva cacheado el App User ID de la cuenta
 * borrada EN ESTE DISPOSITIVO, y el siguiente "restaurar compras" reasocia la compra al
 * perfil anonimizado. Es el agujero que está en nuestra app y no en su capa.
 */
describe('logOutPurchases', () => {
  it('cierra la sesión del SDK', async () => {
    const m = await load();
    await m.configurePurchases(PROFILE);
    await m.logOutPurchases();
    expect(calls.some((c) => c.fn === 'logOut')).toBe(true);
    expect(m.currentPurchasesUser()).toBeNull();
  });

  it('NUNCA lanza: es parte de un camino de salida', async () => {
    throwOnLogOut.value = true;
    const m = await load();
    await m.configurePurchases(PROFILE);
    await expect(m.logOutPurchases()).resolves.toBeUndefined();
    expect(m.currentPurchasesUser()).toBeNull();
  });

  it('sin SDK configurado es un no-op', async () => {
    const m = await load();
    await m.logOutPurchases();
    expect(calls).toHaveLength(0);
  });

  // Tras cerrar, volver a entrar tiene que CONFIGURAR de nuevo con el nuevo perfil y no
  // heredar el anterior.
  it('después de logOut, el siguiente perfil no hereda nada', async () => {
    const m = await load();
    await m.configurePurchases(PROFILE);
    await m.logOutPurchases();
    await m.configurePurchases(OTHER);
    const last = calls.filter((c) => c.fn === 'configure').at(-1);
    expect(last?.arg).toMatchObject({ appUserID: OTHER });
  });
});

/**
 * "Restaurar compras" devuelve una PISTA, no un permiso. Quien abre el gate es el
 * servidor (`my_subscription_status`). Por eso restaurar no puede crear ni revivir
 * ningún perfil: este módulo no habla con Supabase en absoluto.
 */
describe('restorePurchases', () => {
  it('dice si la tienda reconoce el entitlement', async () => {
    const m = await load();
    expect(await m.restorePurchases()).toEqual({ ok: true, entitled: true });
  });

  it('sin compras devuelve entitled:false, no un error', async () => {
    purchaseInfo.entitled = false;
    const m = await load();
    expect(await m.restorePurchases()).toEqual({ ok: true, entitled: false });
  });

  // El candado: si este módulo tocara la base de datos, restaurar podría escribir.
  it('el módulo NO importa Supabase por ningún lado', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/subscription/purchases.ts'), 'utf8');
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/@misterfc\/core/);
  });
});

describe('purchasePackage', () => {
  it('una compra buena dice si quedó con entitlement', async () => {
    const m = await load();
    await m.configurePurchases(PROFILE);
    expect(await m.purchasePackage({} as never)).toEqual({ ok: true, entitled: true });
  });

  // Cerrar la hoja de pago no es un fallo y no se le enseña nada al usuario.
  it('cancelar NO es un error', async () => {
    purchaseThrows.value = { userCancelled: true };
    const m = await load();
    await m.configurePurchases(PROFILE);
    expect(await m.purchasePackage({} as never)).toEqual({ ok: false, cancelled: true });
  });

  it('un fallo real sí lo es', async () => {
    purchaseThrows.value = new Error('store down');
    const m = await load();
    await m.configurePurchases(PROFILE);
    expect(await m.purchasePackage({} as never)).toMatchObject({
      ok: false,
      cancelled: false,
    });
  });
});

describe('loadOffering', () => {
  it('prefiere el offering del proyecto y su producto anual', async () => {
    const annual = { product: { identifier: 'com.misterfc.app.suscripcion.anual' } };
    const otro = { product: { identifier: 'otro' } };
    offerings.value = {
      all: { default_misterfc: { availablePackages: [otro, annual], annual: null } },
      current: null,
    };
    const m = await load();
    const res = await m.loadOffering();
    expect(res).toMatchObject({ ok: true, annual });
  });

  it('si no hay offerings no revienta: devuelve annual null', async () => {
    offerings.value = { all: {}, current: null };
    const m = await load();
    expect(await m.loadOffering()).toEqual({ ok: true, annual: null, packages: [] });
  });

  it('un fallo del SDK sale como ok:false', async () => {
    offerings.value = new Error('sin red');
    const m = await load();
    expect((await m.loadOffering()).ok).toBe(false);
  });
});
