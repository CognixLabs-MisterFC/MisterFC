export { fetchCached, type NativeDbClient } from './client-data';
export { getIsOnline, useIsOnline } from './connectivity';
export { secureCacheBacking } from './secure-cache-backing';
// Write-guard puro de core, re-exportado para las tandas que escriben (E).
export {
  assertOnline,
  guardedWrite,
  OfflineError,
  isOfflineError,
} from '@misterfc/core';
