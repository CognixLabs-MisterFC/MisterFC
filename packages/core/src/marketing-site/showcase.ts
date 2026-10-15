/**
 * Apartado de clubes de la portada (spec §7.2): OCULTO hasta tener permiso por escrito.
 *
 * Se pinta solo si se cumplen LAS DOS:
 *   · `NEXT_PUBLIC_WEB_SHOWCASE === 'on'` (exacto; cualquier otra cosa lo deja oculto);
 *   · al menos un club con `permisoFirmado` (fecha del permiso, AAAA-MM-DD).
 * En cualquier otro caso no se pinta NADA: ni título, ni hueco, ni «próximamente».
 *
 * Un club sin fecha de permiso válida no cuenta y no se pinta aunque esté en la lista.
 */
export type ShowcaseClub = {
  readonly nombre: string;
  /** Ruta bajo `public/` del logo, subido a mano con el permiso. Nunca de la base de datos. */
  readonly logo: string;
  readonly cita?: string;
  readonly autor?: string;
  /** Fecha del permiso firmado, `AAAA-MM-DD`. */
  readonly permisoFirmado: string;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function showcaseClubs(
  env: Readonly<Record<string, string | undefined>>,
  clubs: readonly ShowcaseClub[],
): readonly ShowcaseClub[] {
  if (env.NEXT_PUBLIC_WEB_SHOWCASE !== 'on') return [];
  return clubs.filter((c) => FECHA.test(c.permisoFirmado.trim()));
}
