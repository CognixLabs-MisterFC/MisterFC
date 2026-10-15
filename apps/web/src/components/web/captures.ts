import { getTranslations } from 'next-intl/server';

/** Códigos de la lista de capturas de la spec (§9.4 web, §9.5 móvil). */
export type CaptureId =
  | 'C1'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'C7'
  | 'C11'
  | 'C12'
  | 'M1'
  | 'M2'
  | 'M3'
  | 'M4'
  | 'M5'
  | 'M6';

/**
 * Devuelve, para un código de captura, las props del hueco (`CapturePlaceholder`): el
 * código, su nombre en el idioma de la página y el rótulo «Captura pendiente».
 */
export async function captureLabels() {
  const t = await getTranslations('webComercial.capturas');
  const pendingLabel = t('pendiente');
  return (id: CaptureId) => ({ id, name: t(id), pendingLabel });
}
