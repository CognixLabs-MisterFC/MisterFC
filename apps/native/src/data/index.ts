export { fetchCached, type NativeDbClient } from './client-data';
export { getCanFetch, getIsOnline, useIsOnline } from './connectivity';
export { secureCacheBacking } from './secure-cache-backing';
// Invalidación de caché tras escritura (mapa único en cache-resources.ts).
export { invalidateAfterWrite, type WriteAction } from './cache-resources';
export { useCached, type CachedState } from './use-cached';
// Write-guard puro de core, re-exportado para las tandas que escriben (E).
export {
  assertOnline,
  guardedWrite,
  OfflineError,
  isOfflineError,
} from '@misterfc/core';
