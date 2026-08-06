/**
 * Utilidades COMUNES de subida de imágenes a Supabase Storage desde la app.
 *
 * `base64ToBytes` decodifica el base64 que devuelve `expo-image-picker` a un
 * `Uint8Array` puro, SIN depender del `atob` global (cuya presencia varía por
 * versión de Hermes). Storage sube el objeto como bytes.
 *
 * Extraído de `screens/family/gestion.tsx` (foto del jugador, O2-5 C2) para
 * reutilizarlo también en el AVATAR del perfil (O2 perfil nativo) sin duplicar.
 * Ambos buckets usan el MISMO mecanismo (image-picker base64 → bytes → upload RLS
 * a la carpeta del propietario); solo cambian bucket, ruta y validación.
 */

/** MIME aceptado → extensión de fichero para nombrar el objeto en Storage. */
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const l = new Uint8Array(256);
  for (let i = 0; i < B64_ALPHABET.length; i++) l[B64_ALPHABET.charCodeAt(i)] = i;
  return l;
})();

/** Decodifica base64 → bytes (sin `atob`). El caller sube el resultado al bucket. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = B64_LOOKUP[clean.charCodeAt(i)]!;
    const e2 = B64_LOOKUP[clean.charCodeAt(i + 1)]!;
    const e3 = B64_LOOKUP[clean.charCodeAt(i + 2)]!;
    const e4 = B64_LOOKUP[clean.charCodeAt(i + 3)]!;
    bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (i + 2 < len) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (i + 3 < len) bytes[p++] = ((e3 & 3) << 6) | e4;
  }
  return bytes;
}
