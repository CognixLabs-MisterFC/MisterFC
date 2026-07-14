import {
  type Role,
  ADMIN_ROLES,
  STAFF_ROLES,
  COACH_ROLES,
  ALL_CLUB_ROLES,
} from '@misterfc/core';
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
  Radio,
  Swords,
  Shield,
  ShieldAlert,
  LayoutGrid,
  LayoutDashboard,
  LineChart,
  BarChart3,
  FileText,
  Settings,
  BookOpen,
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

// Conjuntos de roles reutilizados (centralizados en @misterfc/core; 'director'
// ya incluido donde toca — F1B-3). ALL incluye jugador; DIRECCION = admin-like.
const ALL: Role[] = [...ALL_CLUB_ROLES];
const STAFF: Role[] = [...STAFF_ROLES];
const DIRECCION: Role[] = [...ADMIN_ROLES];
// C-2b — Estructura del club: DIRECCION SIN coordinador (el coordinador no ve las
// entradas de estructura: dashboard, equipos, importar, informes/campañas,
// invitaciones). No se toca ADMIN_ROLES/DIRECCION: las entradas que el coordinador
// SÍ conserva (jugadores, anuncios) siguen en DIRECCION.
const ESTRUCTURA: Role[] = ADMIN_ROLES.filter((r) => r !== 'coordinador');

/**
 * Entradas del menú lateral, en orden. Mezcla enlaces simples y HUBS. Los hubs
 * "Entrenamientos", "Partidos" y "Plantilla" compactan el sidebar: su detalle
 * vive en la página-hub (tarjetas que enlazan a las rutas EXISTENTES, sin
 * moverlas). El gating por rol/capability de cada sub-área se preserva: lo
 * decide el `roles` del hijo + el guard/RLS de su ruta.
 */
// F14E-1 — Orden REORDENADO por rol (Jose). El orden lo da la posición en el
// array + los roles[] de cada entrada; un único array produce los 5 menús
// objetivo (superadmin/admin/director/entrenador/jugador) al proyectar por rol.
// La Consola de plataforma del superadmin NO va aquí (la pinta el sidebar, 1ª).
export const NAV: readonly NavEntry[] = [
  { key: 'home', href: '', icon: Home, roles: ALL },
  // Dirección: dashboard ejecutivo (top-level; el gating real es server-side).
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ESTRUCTURA },

  // Vistas de equipo por rol (top-level simples; no entran en hubs de staff).
  // E-final-1: el coordinador entra por "Mis equipos" (es staff de sus equipos) —
  // su puerta a la ficha/acciones de equipo (E-3). admin/director siguen por
  // /equipos (estructura), no aquí.
  { key: 'mis_equipos', href: '/mis-equipos', icon: Shield, roles: [...COACH_ROLES, 'coordinador'] },

  { key: 'calendario', href: '/calendario', icon: Calendar, roles: ALL },

  // E-7b — Cuerpo técnico VISTA LIGERA (read-only, solo nombre+rol de sus equipos,
  // sin contacto/CSV/gestión) para principal/ayudante/jugador. Misma etiqueta
  // shell.nav.cuerpo_tecnico que la entrada de dirección, pero roles DISJUNTOS y
  // destino distinto (/mi-equipo/cuerpo-tecnico) → nadie ve las dos.
  {
    key: 'cuerpo_tecnico',
    href: '/mi-equipo/cuerpo-tecnico',
    icon: UsersRound,
    roles: [...COACH_ROLES, 'jugador'],
  },

  { key: 'mi_equipo', href: '/mi-equipo', icon: Shield, roles: ['jugador'] },

  // F5B-0 — "Equipos" como pestaña TOP-LEVEL (dirección): acceso directo al
  // listado de equipos del club por temporada. Coexiste con la tarjeta 'equipos'
  // del hub Plantilla (misma ruta /equipos; decisión de Jose). Mismos roles.
  { key: 'equipos', href: '/equipos', icon: FolderKanban, roles: ESTRUCTURA },

  // E-7b — Cuerpo técnico VISTA DIRECCIÓN (lista + filtro por equipo + CSV), ENCIMA
  // de Plantilla. roles = DIRECCION (admin/director/coordinador): sale del hub
  // Plantilla y del rango MANAGER_ROLES → el entrenador_principal deja de verla
  // (pasa a la vista ligera). admin/director club-wide (E-7a), coordinador acotado
  // a sus equipos (serie C, ya en el resolver).
  { key: 'cuerpo_tecnico', href: '/cuerpo-tecnico', icon: UsersRound, roles: DIRECCION },

  // HUB Plantilla — jugadores + importar + equipos.
  {
    key: 'plantilla',
    href: '/plantilla',
    icon: Users,
    children: [
      // admin/coord ven la plantilla completa del club.
      { key: 'jugadores', href: '/jugadores', icon: Users, roles: DIRECCION },
      // F14E-1: SOLO import_players pasa a DIRECCION (antes MANAGER_ROLES) → el
      // entrenador_principal deja de ver Importar/Plantilla en el nav (NO revoca
      // la página). E-7b: cuerpo_tecnico sale de este hub a una entrada top-level
      // ENCIMA de Plantilla (vista dirección) + una vista ligera bajo Calendario.
      { key: 'import_players', href: '/plantilla/importar', icon: Upload, roles: ESTRUCTURA },
      // Estructura: listado de equipos por temporada + categorías-plantilla.
      { key: 'equipos', href: '/equipos', icon: FolderKanban, roles: ESTRUCTURA },
      // F13.10g — centro de mando de campañas de informes (admin/coord).
      { key: 'informes_dev', href: '/plantilla/informes', icon: ClipboardList, roles: ESTRUCTURA },
    ],
  },

  // HUB Entrenamientos — ejercicios (staff) + asistencia (todos) [+ sesiones F12].
  // Para el JUGADOR colapsa a su único hijo 'asistencia' (etiqueta "Entrenamientos").
  {
    key: 'entrenamientos',
    href: '/entrenamientos',
    icon: GraduationCap,
    children: [
      { key: 'ejercicios', href: '/ejercicios', icon: GraduationCap, roles: STAFF },
      // Planificador de sesiones (F12) — solo staff.
      { key: 'sesiones', href: '/sesiones', icon: ClipboardList, roles: STAFF },
      // Pizarra táctica efímera (F11B) — solo staff. (E-9: 'jugadas'/Playbook salió
      // de este hub al hub Partidos; la pizarra se queda, es otra cosa.)
      { key: 'pizarra', href: '/pizarra', icon: PenTool, roles: STAFF },
      { key: 'asistencia', href: '/asistencia', icon: Calendar, roles: ALL },
      // F14E-4 — Planificación compartida (SOLO jugador): las sesiones que el
      // entrenador ha compartido (visibility='team'), en solo lectura. Al ser el
      // 2º hijo visible del jugador, "Entrenamientos" deja de colapsar y pasa a
      // hub de 2 tarjetas (Asistencia + Planificación). El staff no lo ve (ya
      // tiene 'sesiones' aquí) → su hub queda intacto.
      { key: 'planificacion', href: '/mi-equipo/sesiones', icon: ClipboardList, roles: ['jugador'] },
    ],
  },

  // E-9 — Playbook del JUGADOR: la entrada apunta al visor REAL (/mi-equipo/jugadas),
  // que ya lista las jugadas compartidas con su equipo (team_plays.shared_with_family).
  // Antes iba a un stub "próximamente" (/playbook, retirado). Etiqueta/roles intactos.
  { key: 'playbook', href: '/mi-equipo/jugadas', icon: BookOpen, roles: ['jugador'] },

  // HUB Partidos — gestión de partidos (todos) + formaciones (staff) + stats (staff).
  // Para el JUGADOR colapsa a 'convocatorias' (etiqueta "Gestión de partidos").
  {
    key: 'partidos',
    href: '/partidos',
    icon: Swords,
    children: [
      { key: 'convocatorias', href: '/convocatorias', icon: Megaphone, roles: ALL },
      { key: 'formaciones', href: '/formaciones', icon: LayoutGrid, roles: STAFF },
      // E-9 — Playbook (banco de jugadas del club, F13): movido aquí desde el hub
      // Entrenamientos. Mismo href/roles/etiqueta; solo cambia de hub padre.
      { key: 'jugadas', href: '/jugadas', icon: Swords, roles: STAFF },
      { key: 'estadisticas_equipo', href: '/estadisticas-equipo', icon: BarChart3, roles: STAFF },
    ],
  },

  // Directos (F7B-3) — pantalla propia de SOLO LECTURA: partidos de la semana +
  // marcador/estado/minuto en vivo. Independiente de la gestión de partidos.
  { key: 'directos', href: '/directos', icon: Radio, roles: ALL },

  { key: 'mi_ficha', href: '/mi-ficha', icon: LineChart, roles: ['jugador'] },
  // Informe de desarrollo (familia/jugador): ruta propia, fuera de /mi-ficha.
  { key: 'mi_informe', href: '/mi-informe', icon: FileText, roles: ['jugador'] },

  { key: 'mensajes', href: '/mensajes', icon: MessageSquare, roles: ALL },

  // Dirección: comunicación club-wide + administración (top-level).
  { key: 'anuncios', href: '/anuncios', icon: Megaphone, roles: DIRECCION },
  { key: 'invitations', href: '/invitations', icon: Mail, roles: ESTRUCTURA },

  // F14C-5 — Seguidores (abuelos/familiares) del jugador: invitar/listar/revocar.
  { key: 'seguidores', href: '/mi-ficha/seguidores', icon: UsersRound, roles: ['jugador'] },

  // F14-7 — bandeja de supresiones (derecho al olvido). F14E-1: SOLO admin_club
  // (se revoca al director, en menú Y en el guard server-side; superadmin entra
  // como admin_club sintético → paridad). coordinador NUNCA la vio.
  { key: 'supresiones', href: '/supresiones', icon: ShieldAlert, roles: ['admin_club'] },

  // F14E-1: Ajustes del club SIN director (lista propia, sin tocar DIRECCION que
  // comparten dashboard/equipos/plantilla/anuncios/invitaciones). coordinador se
  // MANTIENE como hoy. Guard server-side también revoca al director.
  { key: 'ajustes', href: '/ajustes', icon: Settings, roles: ['admin_club', 'coordinador'] },

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
