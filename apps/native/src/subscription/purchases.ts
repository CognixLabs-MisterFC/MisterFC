/**
 * SU-4 — envoltorio del SDK de RevenueCat. ÚNICO sitio que importa
 * `react-native-purchases`; todo lo demás habla con estas funciones.
 *
 * Datos del proyecto (dados por Jose, literales y exactos):
 *   entitlement  PREMIUM        ← en MAYÚSCULAS. Un identificador mal escrito no da
 *                                 error: devuelve "no tiene acceso" en silencio.
 *   offering     default_misterfc
 *   producto     com.misterfc.app.suscripcion.anual
 *
 * Las claves públicas van por entorno (`EXPO_PUBLIC_*`, inlined por Metro), una por
 * tienda. Son claves PÚBLICAS de SDK: no son la secret key, que vive solo en el
 * servidor (SU-3) y no puede entrar aquí.
 *
 * ⚠️ ANDROID NO ESTÁ CONFIGURADO todavía. Si falta la clave de la plataforma, el SDK
 * NO se configura y `canPurchase()` es false: la pantalla de suscripción lo dice en
 * vez de ofrecer un botón que no puede funcionar.
 */

import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';

/** Identificador del entitlement en RevenueCat. Literal, en mayúsculas. */
export const ENTITLEMENT_ID = 'PREMIUM';

/** Offering por defecto del proyecto. */
export const OFFERING_ID = 'default_misterfc';

/** Producto anual. Se usa solo para diagnosticar, no para comprar (se compra el paquete). */
export const ANNUAL_PRODUCT_ID = 'com.misterfc.app.suscripcion.anual';

function apiKeyForPlatform(): string | null {
  const key =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  return key && key.length > 0 ? key : null;
}

/** ¿Se puede cobrar en ESTA plataforma? False mientras falte la clave (Android hoy). */
export function canPurchase(): boolean {
  return apiKeyForPlatform() !== null;
}

let configuredFor: string | null = null;

/**
 * Configura el SDK y lo identifica como `profileId`.
 *
 * El App User ID es SIEMPRE nuestro `profiles.id` (ADR-0022 §1). Nunca se deja el
 * anónimo que genera el SDK para alguien ya autenticado: ese es el camino por el que
 * una compra acaba colgada de una identidad que no controlamos.
 *
 * Idempotente: `configure` una vez por arranque, y `logIn` solo si cambia la persona.
 */
export async function configurePurchases(profileId: string): Promise<boolean> {
  const key = apiKeyForPlatform();
  if (!key) return false;

  if (configuredFor === profileId) return true;

  if (configuredFor === null) {
    // `typeof` y no `__DEV__` a secas: es un global que inyecta Metro, y sin la
    // guarda este módulo no se puede cargar en los tests (entorno Node).
    if (typeof __DEV__ !== 'undefined' && __DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    // `appUserID` desde el principio: así no existe ni un instante con el anónimo.
    Purchases.configure({ apiKey: key, appUserID: profileId });
  } else {
    await Purchases.logIn(profileId);
  }
  configuredFor = profileId;
  return true;
}

/**
 * Cierra la sesión del SDK. **Obligatorio** al borrar la cuenta y al cerrar sesión.
 *
 * Sin esto el SDK conserva cacheado el App User ID en el dispositivo, y un "Restaurar
 * compras" posterior en ese mismo móvil vuelve a asociar la compra a la cuenta
 * anterior. Con una cuenta borrada eso es el incidente de privacidad que ADR-0022 §4b
 * existe para impedir, y el agujero está aquí, no en la capa de RevenueCat.
 *
 * Nunca lanza: es parte de un camino de salida y no puede impedirlo.
 */
export async function logOutPurchases(): Promise<void> {
  if (configuredFor === null) return;
  try {
    await Purchases.logOut();
  } catch {
    // El SDK rechaza `logOut` si el usuario ya es anónimo. Da igual: el objetivo
    // (que el dispositivo deje de presentar ese App User ID) ya está cumplido.
  }
  configuredFor = null;
}

/** ¿Quién cree el SDK que es? Solo para diagnóstico y para el candado de los tests. */
export function currentPurchasesUser(): string | null {
  return configuredFor;
}

export type OfferingResult =
  | { ok: true; annual: PurchasesPackage | null; packages: PurchasesPackage[] }
  | { ok: false; raw: unknown };

/** El offering `default_misterfc`. Si no está, se cae al `current` que diga el panel. */
export async function loadOffering(): Promise<OfferingResult> {
  try {
    const offerings = await Purchases.getOfferings();
    const offering = offerings.all[OFFERING_ID] ?? offerings.current;
    if (!offering) return { ok: true, annual: null, packages: [] };
    const packages = offering.availablePackages;
    const annual =
      packages.find((p) => p.product.identifier === ANNUAL_PRODUCT_ID) ??
      offering.annual ??
      packages[0] ??
      null;
    return { ok: true, annual, packages };
  } catch (e) {
    return { ok: false, raw: e };
  }
}

export type PurchaseResult =
  | { ok: true; entitled: boolean }
  /** El usuario cerró la hoja de pago. No es un error y no se le enseña nada. */
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; raw: unknown };

function isEntitled(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, entitled: isEntitled(customerInfo) };
  } catch (e) {
    const cancelled =
      typeof e === 'object' && e !== null && (e as { userCancelled?: boolean }).userCancelled === true;
    if (cancelled) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, raw: e };
  }
}

/**
 * "Restaurar compras".
 *
 * Lo que devuelve es **una pista, no un permiso**: quien abre el gate es el servidor
 * (`my_subscription_status`), nunca esto. Por eso restaurar no puede crear ni revivir
 * ningún perfil — no escribe en nuestra base de datos, y el único camino que escribe
 * es el webhook, que ya se niega a tocar cuentas borradas (SU-1/SU-3).
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, entitled: isEntitled(info) };
  } catch (e) {
    return { ok: false, cancelled: false, raw: e };
  }
}
