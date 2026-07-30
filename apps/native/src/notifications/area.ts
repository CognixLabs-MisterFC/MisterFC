import { navAreaForRole, type Role } from '@misterfc/core';
import type { ChromeArea } from '@/nav/config';
import type { UserKind } from '@/auth/context';

/**
 * O2-4 PR-2 — Área de carcasa del usuario (family/staff/direction/spectator) a
 * partir de su tipo + rol, o `null` si aún no se conoce (app cargando / sin
 * acceso). La proyección rol→área viene SIEMPRE de core (`navAreaForRole`), igual
 * que el gatekeeper (app/index.tsx). El deep link la necesita para construir la
 * ruta dentro del área correcta.
 */
export function chromeAreaFor(
  kind: UserKind,
  role: Role | null,
): ChromeArea | null {
  if (kind === 'spectator') return 'spectator';
  if (kind === 'member' && role) return navAreaForRole(role);
  return null;
}
