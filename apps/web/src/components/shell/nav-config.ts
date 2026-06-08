import type { Role } from '@misterfc/core';
import {
  Home,
  FolderKanban,
  Mail,
  MessageSquare,
  UserRound,
  Users,
  UsersRound,
  ClipboardCheck,
  Megaphone,
  Upload,
  Calendar,
  Shield,
  LayoutGrid,
  Settings,
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
    // admin/coord ven la plantilla completa del club.
    roles: ['admin_club', 'coordinador'],
  },
  {
    key: 'mis_equipos',
    href: '/mis-equipos',
    icon: Shield,
    // Hub multi-equipo del coach: lista de equipos + accesos contextuales
    // a convocatoria, asistencia y calendario del equipo.
    // Admin/coord NO tienen `/mis-equipos`: usan `/jugadores` global.
    roles: ['entrenador_principal', 'entrenador_ayudante'],
  },
  {
    key: 'mi_equipo',
    href: '/mi-equipo',
    icon: Shield,
    // F5.8 — Vista equipo para el jugador (compañeros + eventos + anuncios).
    // Solo rol jugador; coaches usan /mis-equipos.
    roles: ['jugador'],
  },
  {
    key: 'cuerpo_tecnico',
    href: '/cuerpo-tecnico',
    icon: UsersRound,
    // Gestión global del cuerpo técnico. Principal ve los staff de SUS
    // equipos (lectura); admin/coord además mueve. Ayudante / jugador no
    // ven la entrada.
    roles: ['admin_club', 'coordinador', 'entrenador_principal'],
  },
  {
    key: 'calendario',
    href: '/calendario',
    icon: Calendar,
    // Calendario visible para todos los roles (cada uno ve filtrado en UI).
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
  {
    key: 'asistencia',
    href: '/asistencia',
    icon: ClipboardCheck,
    // Asistencia: cuerpo técnico marca, jugador/familia ve solo lo suyo.
    // El ayudante necesita `can_mark_attendance` para que la page muestre
    // datos; la nav se le enseña igual y la propia page filtra.
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
  {
    key: 'convocatorias',
    href: '/convocatorias',
    icon: Megaphone,
    // Convocatorias de partido. Todos los roles ven entrada; la page
    // diferencia vista jugador/familia (responder) vs cuerpo técnico
    // (publicar + descartar). Ayudante necesita can_manage_callups para
    // las acciones de gestión; la entrada le aparece igual.
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
  {
    key: 'formaciones',
    href: '/formaciones',
    icon: LayoutGrid,
    // F6.10 — plantillas personalizadas de formación del coach. Visible para
    // staff (admin/coord + entrenadores); la page gatea el botón "Nueva" y la
    // RLS gatea el INSERT según la autoridad de alineaciones.
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
    ],
  },
  {
    key: 'import_players',
    href: '/plantilla/importar',
    icon: Upload,
    // Entrenadores con `can_manage_squad` también podrían usarlo. Esta nav lo
    // dejamos restringido a roles que SIEMPRE pueden; la page hace el check
    // de capability para el ayudante.
    roles: ['admin_club', 'coordinador', 'entrenador_principal'],
  },
  {
    key: 'anuncios',
    href: '/anuncios',
    icon: Megaphone,
    // Anuncios globales del club. Admin/coord pueden publicar club-wide
    // o seleccionar varios teams; coaches usan /equipos/[teamId]/anuncios
    // para su team específico.
    roles: ['admin_club', 'coordinador'],
  },
  {
    key: 'mensajes',
    href: '/mensajes',
    icon: MessageSquare,
    // Mensajería 1:1. Cualquier rol puede tener conversaciones (coach inicia;
    // jugador/familia recibe y responde). El badge de no leídos lo gestiona
    // la propia /mensajes; aquí solo entry point.
    roles: [
      'admin_club',
      'coordinador',
      'entrenador_principal',
      'entrenador_ayudante',
      'jugador',
    ],
  },
  {
    key: 'invitations',
    href: '/invitations',
    icon: Mail,
    roles: ['admin_club', 'coordinador'],
  },
  {
    key: 'ajustes',
    href: '/ajustes',
    icon: Settings,
    // F8.5 — ajustes del club (visibilidad de valoraciones). Admin/coord ven la
    // entrada; solo el admin puede cambiar el flag (la page deshabilita el
    // control para coord y la RLS rechaza la escritura del no-admin).
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
