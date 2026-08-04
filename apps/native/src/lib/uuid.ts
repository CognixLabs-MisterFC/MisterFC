/**
 * O2-9b — UUID v4 generado en el CLIENTE, sin dependencia nativa.
 *
 * Se usa SOLO como PK de idempotencia de `match_events` (`onConflict:'id',
 * ignoreDuplicates`): lo único que importa es que sea ÚNICO en el dispositivo y
 * tenga FORMATO v4 válido (pasa `z.string().uuid()` del schema). No es un secreto
 * ni un token → NO necesita fuerza criptográfica, así que evitamos añadir un
 * módulo nativo (expo-crypto exigiría prebuild). Formato RFC 4122 v4 correcto
 * (nibble de versión '4' y variante 8/9/a/b). La probabilidad de colisión entre
 * la decena de eventos de un partido es despreciable.
 */
export function uuidv4(): string {
  let seed = Date.now();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (seed + Math.random() * 16) % 16 | 0;
    seed = Math.floor(seed / 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
