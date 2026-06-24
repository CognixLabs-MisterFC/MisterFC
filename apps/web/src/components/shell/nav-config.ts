import type { Role } from '@misterfc/core';
import {
  Home,
  FolderKanban,
  Mail,
  MessageSquare,
  UserRound,
  Users,
  UsersRound,
  Megaphone,
  Upload,
  Calendar,
  GraduationCap,
  ClipboardList,
  PenTool,
  Swords,
  Shield,
  LayoutGrid,
  LayoutDashboard,
  LineChart,
  BarChart3,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/** Enlace simple del menú (hoja). */
export type NavLink = {
  /** Clave i18n bajo `shell.nav.<key>`. */
  key: string;
  /** Path tras `/{locale}` (ej. `/jugadores`). Sin trailing slash. */
  href: string;
  icon: LucideIcon;
  /** Roles que ven esta entrada. */
  roles: Role[];
};

/**
 * HUB: una sola entrada en el sidebar → su PÁGINA (con tarjetas) agrupa los
 * hijos. El sidebar NO despliega los hijos; el detalle vive en la página-hub
 * (patrón "Entrenamientos"). `href` es la ruta de la página-hub. Los `roles` se
 * DERIVAN de los hijos (un hub se ve si el rol ve ≥1 hijo).
 *
 * Regla del HIJO ÚNICO: si para un rol solo hay UN hijo visible, el sidebar
 * enlaza DIRECTO a ese hijo (sin pasar por la página-hub de una sola tarjeta).
 */
export type NavHub = {
  key: string;
  href: string;
  icon: LucideIcon;
  children: NavLink[];
};

export type NavEntry = NavLink | NavHub;

export function isNavHub(entry: NavEntry): entry is NavHub {
  return 'children' in entry;
}

// Conjuntos de roles reutilizados.
const ALL: Role[] = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
];
const STAFF: Role[] = ['admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante'];
const DIRECCION: Role[] = ['admin_club', 'coordinador'];

/**
 * Entradas del menú lateral, en orden. Mezcla enlaces simples y HUBS. Los hubs
 * "Entrenamientos", "Partidos" y "Plantilla" compactan el sidebar: su detalle
 * vive en la página-hub (tarjetas que enlazan a las rutas EXISTENTES, sin
 * moverlas). El gating por rol/capability de cada sub-área se preserva: lo
 * decide el `roles` del hijo + el guard/RLS de su ruta.
 */
export const NAV: readonly NavEntry[] = [
  { key: 'home', href: '', icon: Home, roles: ALL },
  // Dirección: dashboard ejecutivo (top-level; el gating real es server-side).
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, roles: DIRECCION },

  // HUB Plantilla — jugadores + importar + cuerpo técnico + equipos.
  {
    key: 'plantilla',
    href: '/plantilla',
    icon: Users,
    children: [
      // admin/coord ven la plantilla completa del club.
      { key: 'jugadores', href: '/jugadores', icon: Users, roles: DIRECCION },
      // Import masivo: roles que SIEMPRE pueden; la page chequea capability del ayudante.
      { key: 'import_players', href: '/plantilla/importar', icon: Upload, roles: ['admin_club', 'coordinador', 'entrenador_principal'] },
      // Gestión global del cuerpo técnico (principal: lectura de SUS equipos).
      { key: 'cuerpo_tecnico', href: '/cuerpo-tecnico', icon: UsersRound, roles: ['admin_club', 'coordinador', 'entrenador_principal'] },
      // Estructura: listado de equipos por temporada + categorías-plantilla.
      { key: 'equipos', href: '/equipos', icon: FolderKanban, roles: DIRECCION },
      // F13.10g — centro de mando de campañas de informes (admin/coord).
      { key: 'informes_dev', href: '/plantilla/informes', icon: ClipboardList, roles: DIRECCION },
    ],
  },

  // Vistas de equipo por rol (top-level simples; no entran en hubs de staff).
  { key: 'mis_equipos', href: '/mis-equipos', icon: Shield, roles: ['entrenador_principal', 'entrenador_ayudante'] },
  { key: 'mi_equipo', href: '/mi-equipo', icon: Shield, roles: ['jugador'] },
  { key: 'mi_ficha', href: '/mi-ficha', icon: LineChart, roles: ['jugador'] },
  // Informe de desarrollo (familia/jugador): ruta propia, fuera de /mi-ficha.
  { key: 'mi_informe', href: '/mi-informe', icon: FileText, roles: ['jugador'] },

  // HUB Entrenamientos — ejercicios (staff) + asistencia (todos) [+ sesiones F12].
  {
    key: 'entrenamientos',
    href: '/entrenamientos',
    icon: GraduationCap,
    children: [
      { key: 'ejercicios', href: '/ejercicios', icon: GraduationCap, roles: STAFF },
      // Planificador de sesiones (F12) — solo staff.
      { key: 'sesiones', href: '/sesiones', icon: ClipboardList, roles: STAFF },
      // Pizarra táctica efímera (F11B) — solo staff.
      { key: 'pizarra', href: '/pizarra', icon: PenTool, roles: STAFF },
      // Playbook de jugadas animadas (F13) — solo staff.
      { key: 'jugadas', href: '/jugadas', icon: Swords, roles: STAFF },
      { key: 'asistencia', href: '/asistencia', icon: Calendar, roles: ALL },
    ],
  },

  // HUB Partidos — gestión de partidos (todos) + formaciones (staff) + stats (staff).
  {
    key: 'partidos',
    href: '/partidos',
    icon: Swords,
    children: [
      { key: 'convocatorias', href: '/convocatorias', icon: Megaphone, roles: ALL },
      { key: 'formaciones', href: '/formaciones', icon: LayoutGrid, roles: STAFF },
      { key: 'estadisticas_equipo', href: '/estadisticas-equipo', icon: BarChart3, roles: STAFF },
    ],
  },

  { key: 'calendario', href: '/calendario', icon: Calendar, roles: ALL },
  { key: 'mensajes', href: '/mensajes', icon: MessageSquare, roles: ALL },

  // Dirección: comunicación club-wide + administración (top-level).
  { key: 'anuncios', href: '/anuncios', icon: Megaphone, roles: DIRECCION },
  { key: 'invitations', href: '/invitations', icon: Mail, roles: DIRECCION },
  { key: 'ajustes', href: '/ajustes', icon: Settings, roles: DIRECCION },

  { key: 'perfil', href: '/perfil', icon: UserRound, roles: ALL },
] as const;

/** Item ya resuelto para pintar en el sidebar (un único enlace). */
export type ResolvedNavItem = { key: string; href: string; icon: LucideIcon };

/**
 * Resuelve el menú para un rol. Los hubs colapsan a enlace directo cuando el rol
 * solo ve un hijo (regla del hijo único), y se omiten si no ve ninguno.
 */
export function resolveNav(role: Role): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = [];
  for (const entry of NAV) {
    if (isNavHub(entry)) {
      const visible = entry.children.filter((c) => c.roles.includes(role));
      if (visible.length === 0) continue;
      if (visible.length === 1) {
        const c = visible[0]!;
        out.push({ key: c.key, href: c.href, icon: c.icon });
      } else {
        out.push({ key: entry.key, href: entry.href, icon: entry.icon });
      }
    } else if (entry.roles.includes(role)) {
      out.push({ key: entry.key, href: entry.href, icon: entry.icon });
    }
  }
  return out;
}

/** Hijos de un hub visibles para un rol (lo usan las páginas-hub para sus tarjetas). */
export function getHubChildren(hubKey: string, role: Role): NavLink[] {
  const hub = NAV.find((e) => isNavHub(e) && e.key === hubKey);
  if (!hub || !isNavHub(hub)) return [];
  return hub.children.filter((c) => c.roles.includes(role));
}
