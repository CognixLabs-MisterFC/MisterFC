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
