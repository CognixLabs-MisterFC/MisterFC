/**
 * F14B-9b — Logo del club para los PDF. @react-pdf/renderer embebe imágenes como
 * data URI base64 (NO por URL), así que descargamos el objeto del bucket público
 * `club-logos` (F14B-9a) y lo convertimos a data URL en el servidor.
 *
 * Degrada con gracia: sin logo (path NULL) o si la descarga falla → null, y la
 * cabecera cae al nombre del club a secas. NUNCA rompe el render del PDF.
 */

import { createSupabaseServerClient } from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * Descarga el logo del club del bucket `club-logos` y lo devuelve como data URI
 * base64. Devuelve null si no hay logo o si la lectura falla (no lanza).
 */
export async function clubLogoDataUrl(
  supabase: Supa,
  logoPath: string | null | undefined,
): Promise<string | null> {
  if (!logoPath) return null;
  try {
    const { data: blob, error } = await supabase.storage
      .from('club-logos')
      .download(logoPath);
    if (error || !blob) return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length === 0) return null;
    const mime = blob.type || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
