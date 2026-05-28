import type { Role } from '@misterfc/core';
import {
  Home,
  FolderKanban,
  Mail,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  /** Clave i18n bajo `shell.nav.<key>.label` */
  key: string;
  /** Path tras `/{locale}` (ej. `/categorias`). Sin trailing slash. */
  href: string;
  icon: LucideIcon;
  /** Roles que ven esta entrada. */
  roles: Role[];
};

/**
 * Entradas del menú lateral, ordenadas según aparecen.
 *
 * Solo entradas cuyo destino exista en el lote actual. Las que aún no
 * tienen implementación (plantilla del club, staff, mi ficha) se añaden
 * cuando llegan sus lotes para que el menú no acabe en 404.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'home',
    href: '',
    icon: Home,
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
  {
    key: 'categorias',
    href: '/categorias',
    icon: FolderKanban,
    roles: ['admin_club', 'coordinador'],
  },
  {
    key: 'jugadores',
    href: '/jugadores',
    icon: Users,
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
    ],
  },
  {
    key: 'invitations',
    href: '/invitations',
    icon: Mail,
    roles: ['admin_club', 'coordinador'],
  },
  {
    key: 'perfil',
    href: '/perfil',
    icon: UserRound,
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
] as const;

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
