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

type CaptureFile = { src: string; width: number; height: number };

export type CaptureImage = CaptureFile & {
  /**
   * `contain` cuando la captura no tiene la forma del marco (los recortes de C3, C5 y
   * C7): se ve entera sobre blanco, el fondo de la app. El resto llena el marco.
   */
  fit: 'cover' | 'contain';
  /** La misma pantalla a 390×844, para el marco de móvil en pantallas pequeñas. */
  mobile?: CaptureFile & { fit: 'cover' | 'contain' };
};

/**
 * Las capturas (spec §9.4 y §9.5), en `public/web/capturas/`, en WebP. Las web se
 * hicieron con Playwright contra producción con el club de test «CF Playas El Saler»
 * (1440×900 y 390×844); las M1–M6, con la app de la tienda.
 *
 * C7 y C11 no tienen versión móvil: el informe no cabe en 390 px y la jugada se ve a
 * pantalla completa. En móvil se enseña la de escritorio.
 */
export const CAPTURES: Record<CaptureId, CaptureImage> = {
  C1: {
    src: '/web/capturas/c1.webp',
    width: 1440,
    height: 900,
    fit: 'cover',
    mobile: { src: '/web/capturas/c1-movil.webp', width: 780, height: 1688, fit: 'cover' },
  },
  C3: {
    src: '/web/capturas/c3.webp',
    width: 944,
    height: 688,
    fit: 'contain',
    mobile: { src: '/web/capturas/c3-movil.webp', width: 780, height: 1688, fit: 'cover' },
  },
  C4: {
    src: '/web/capturas/c4.webp',
    width: 1440,
    height: 900,
    fit: 'cover',
    mobile: { src: '/web/capturas/c4-movil.webp', width: 780, height: 1688, fit: 'cover' },
  },
  C5: {
    src: '/web/capturas/c5.webp',
    width: 472,
    height: 696,
    fit: 'contain',
    mobile: { src: '/web/capturas/c5-movil.webp', width: 944, height: 1392, fit: 'contain' },
  },
  C7: { src: '/web/capturas/c7.webp', width: 1440, height: 837, fit: 'contain' },
  C11: { src: '/web/capturas/c11.webp', width: 1440, height: 900, fit: 'cover' },
  C12: {
    src: '/web/capturas/c12.webp',
    width: 1440,
    height: 900,
    fit: 'cover',
    mobile: { src: '/web/capturas/c12-movil.webp', width: 780, height: 1688, fit: 'cover' },
  },
  M1: { src: '/web/capturas/m1.webp', width: 720, height: 1640, fit: 'cover' },
  M2: { src: '/web/capturas/m2.webp', width: 720, height: 1640, fit: 'cover' },
  M3: { src: '/web/capturas/m3.webp', width: 720, height: 1640, fit: 'cover' },
  M4: { src: '/web/capturas/m4.webp', width: 720, height: 1640, fit: 'cover' },
  M5: { src: '/web/capturas/m5.webp', width: 720, height: 1640, fit: 'cover' },
  M6: { src: '/web/capturas/m6.webp', width: 720, height: 1640, fit: 'cover' },
};

/**
 * Devuelve, para un código de captura, las props del marco (`CaptureFrame`): el código,
 * su descripción en el idioma de la página, que es el texto alternativo de la imagen, y
 * los textos del botón que la amplía y del que cierra la ampliación.
 */
export async function captureLabels() {
  const t = await getTranslations('webComercial.capturas');
  const tz = await getTranslations('webComercial.ampliar');
  return (id: CaptureId) => ({
    id,
    name: t(id),
    zoom: {
      open: tz('abrir', { name: t(id) }),
      close: tz('cerrar'),
      hint: tz('pista'),
      hintRotate: tz('pistaGirar'),
    },
  });
}
