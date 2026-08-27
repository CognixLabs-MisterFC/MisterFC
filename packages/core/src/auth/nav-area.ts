import type { Role } from './current-user';

/**
 * O2-2 — Área de NAVEGACIÓN de la app nativa a la que se proyecta cada rol de
 * club. Es una decisión de PRODUCTO sobre la carcasa (barra + menú), NO un gate
 * de seguridad (esos viven en RLS/RPC) ni la proyección de permisos de UI de web
 * (`ADMIN_ROLES`/`STAFF_ROLES`…).
 *
 *  - 'family'    → jugador/familia.
 *  - 'staff'     → cuerpo técnico: principal, ayudante y COORDINADOR.
 *  - 'direction' → dirección: admin_club y director.
 *
 * OJO — divergencia deliberada con `ADMIN_ROLES` (roles.ts): allí `coordinador`
 * se agrupa con admin/director (gestión de club); AQUÍ, para la CARCASA, el
 * coordinador usa la barra y el menú de CUERPO TÉCNICO (5 tabs), no la de
 * dirección. El menú del coordinador añade sus extras de coordinación por encima
 * (lo resuelve la config de navegación de apps/native), pero su ÁREA es 'staff'.
 * No unifiques ambas proyecciones: responden a preguntas distintas.
 *
 * El SEGUIDOR (espectador) NO es un rol de club: se detecta antes (is_spectator)
 * y tiene su propia área/carcasa; por eso no aparece aquí.
 */
export type NavArea = 'family' | 'staff' | 'direction';

/** Proyecta un rol de club a su área de navegación (carcasa) en la app nativa. */
export function navAreaForRole(role: Role): NavArea {
  switch (role) {
    case 'admin_club':
    case 'director':
      return 'direction';
    case 'coordinador':
    case 'entrenador_principal':
    case 'entrenador_ayudante':
      return 'staff';
    case 'jugador':
      return 'family';
  }
}

/**
 * Área de carcasa incluyendo la del SEGUIDOR (que no es un rol de club). Coincide
 * con `ChromeArea` de apps/native; se define aquí para que la regla de acceso
 * viva junto a `navAreaForRole` y sea testeable en core.
 */
export type NavAudienceArea = NavArea | 'spectator';

/** Tipo de usuario tras login (espejo de `UserKind` de apps/native). */
export type NavUserKind = 'member' | 'spectator' | 'none';

/**
 * O2-2 — Regla PURA de acceso a un área de carcasa (defensa en profundidad: cada
 * layout de área la usa para protegerse a sí mismo, además del gatekeeper).
 *
 *  - área 'spectator' → solo el seguidor (kind==='spectator').
 *  - áreas family/staff/direction → solo un miembro cuyo rol de club activo
 *    PROYECTA a esa área según `navAreaForRole` (fuente única de la proyección).
 *
 * S2 director-entrenador — ÚNICA excepción al 1:1 rol↔área: un miembro cuyo hogar
 * es 'direction' (admin_club/director) y que ADEMÁS está asignado como team_staff
 * de algún equipo (`hasStaffTeams`) puede entrar TAMBIÉN en 'staff' (modo
 * entrenador, conmutador de S2-2). `navAreaForRole` NO cambia: su hogar sigue
 * siendo dirección (gatekeeper y router de push intactos); esto solo AÑADE 'staff'
 * como área permitida cuando tiene equipos. El resto sigue 1:1:
 *  · un director SIN equipos (hasStaffTeams=false) NO entra en 'staff';
 *  · un coordinador/entrenador (hogar 'staff') NO entra en 'direction' — la
 *    excepción es solo direction→staff, nunca al revés.
 *
 * Cualquier otro caso (rol de otra área, sin rol, sin sesión) NO pertenece.
 */
export function isAllowedInArea(
  area: NavAudienceArea,
  audience: { kind: NavUserKind; role: Role | null; hasStaffTeams?: boolean }
): boolean {
  if (area === 'spectator') return audience.kind === 'spectator';
  if (audience.kind !== 'member' || audience.role == null) return false;
  const home = navAreaForRole(audience.role);
  if (home === area) return true;
  // Excepción S2: director/admin_club con equipos asignados → también 'staff'.
  return (
    area === 'staff' &&
    home === 'direction' &&
    audience.hasStaffTeams === true
  );
}
