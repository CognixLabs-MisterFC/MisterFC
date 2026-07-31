import type { CacheBacking } from '@misterfc/core';
import { SecureStoreAdapter } from '@/lib/secure-store-adapter';

/**
 * O2-5 — Backing de la caché de lectura offline (core `readThrough`) sobre el
 * almacén CIFRADO del dispositivo.
 *
 * ADR-0020 Decisión 5 + tratamiento de datos de menores/médicos: lo descargado
 * para leer sin cobertura puede incluir ficha/informe del jugador → va a
 * expo-secure-store, NUNCA a AsyncStorage/filesystem sin cifrar. Reutiliza el
 * `SecureStoreAdapter` (mismo troceo que la sesión) como KV de strings; el
 * `readThrough` de core serializa/deserializa JSON por su cuenta.
 *
 * (Un backing NO cifrado para datos no sensibles y voluminosos —directos,
 * calendario club-wide— se podría añadir en tandas siguientes inyectando otro
 * `CacheBacking`; aquí el default seguro cubre todo.)
 */
export const secureCacheBacking: CacheBacking = {
  getItem: (key) => SecureStoreAdapter.getItem(key),
  setItem: (key, value) => SecureStoreAdapter.setItem(key, value),
  removeItem: (key) => SecureStoreAdapter.removeItem(key),
};
