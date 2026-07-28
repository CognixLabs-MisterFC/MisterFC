import * as SecureStore from 'expo-secure-store';

/**
 * Adaptador de almacenamiento para la sesión de Supabase sobre expo-secure-store.
 *
 * ADR-0020 exige `expo-secure-store` (almacén cifrado del dispositivo) y PROHÍBE
 * AsyncStorage, por manejarse datos de menores y datos médicos.
 *
 * SecureStore limita cada valor a ~2048 bytes (Android). La sesión de Supabase
 * (JWT de acceso + refresh) puede superarlo, así que troceamos el valor en
 * fragmentos y guardamos un índice con el número de fragmentos. Los valores
 * pequeños siguen leyéndose aunque se guardaran sin trocear (compatibilidad).
 */
const CHUNK_SIZE = 2000;
const countKey = (key: string) => `${key}::chunks`;
const chunkKey = (key: string, i: number) => `${key}::${i}`;

async function getItem(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(countKey(key));
  if (countRaw == null) {
    // No hay índice de fragmentos: valor pequeño guardado directo (o inexistente).
    return SecureStore.getItemAsync(key);
  }
  const count = Number.parseInt(countRaw, 10);
  let out = '';
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part == null) return null;
    out += part;
  }
  return out;
}

async function removeItem(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(countKey(key));
  if (countRaw != null) {
    const count = Number.parseInt(countRaw, 10);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  }
  await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  // Limpia cualquier estado previo (troceado o no) antes de reescribir.
  await removeItem(key);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]!);
  }
}

/** Contrato `SupportedStorage` de supabase-js (getItem/setItem/removeItem). */
export const SecureStoreAdapter = { getItem, setItem, removeItem };
