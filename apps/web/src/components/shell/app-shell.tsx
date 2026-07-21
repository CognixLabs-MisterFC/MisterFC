import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@misterfc/core';
import type { ShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadUpcomingCallups } from '@/app/[locale]/(authenticated)/convocatorias/queries';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { SuperadminBanner } from './superadmin-banner';
import { SIDEBAR_COLLAPSED_COOKIE } from './sidebar-toggle';

type Props = {
  ctx: ShellContext;
  locale: string;
  children: ReactNode;
  /** F14B-7 — muestra el enlace a la consola de plataforma (solo superadmin). */
  isSuperadmin?: boolean;
};

/**
 * Cuenta el número de CHATS con mensajes no leídos para el user actual: chats
 * 1-a-1 + chats de EQUIPO. Unidad homogénea = NÚMERO DE CHATS con no-leídos (no
 * suma de mensajes), coherente entre ambos subsistemas (E-8).
 *
 * Bug M (PR #32): la query directa sobre `messages` con `.is(read_at,null)
 * .neq(sender_profile_id, user_id)` no devolvía filas para admin_club en
 * runtime — el badge salía en 0. La RPC hace el predicate de participante
 * inline (sin pasar por la RLS de messages) y devuelve un único int. Más
 * robusto y más barato (el planner hace count distinct + join, en lugar
 * de scan + dedupe en JS).
 *
 * E-8: antes solo contaba 1-a-1 (`user_unread_conversations_count`) → el badge
 * ignoraba los chats de equipo. Ahora suma también el nº de chats de equipo con
 * no-leídos, reutilizando el RPC existente `team_chat_unread_counts()` (el mismo
 * que usa /mensajes; SECURITY DEFINER, ya excluye mensajes propios, solo chats
 * donde participa y solo posteriores a last_read_at). Se cuentan las FILAS con
 * unread>0 (un chat de equipo cuenta como 1, no como nº de mensajes). Si ese RPC
 * falla/da null, el lado equipo aporta 0 y el badge 1-a-1 sigue funcionando.
 */
async function loadUnreadConversationsCount(
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<number> {
  const { data: oneToOneData } = await supabase.rpc(
    'user_unread_conversations_count',
  );
  const oneToOne = typeof oneToOneData === 'number' ? oneToOneData : 0;

  const { data: teamRows } = await supabase.rpc('team_chat_unread_counts');
  const teamChatsWithUnread = (teamRows ?? []).filter(
    (r) => (r.unread ?? 0) > 0,
  ).length;

  return oneToOne + teamChatsWithUnread;
}

/**
 * PART 3.4 — badge verde de "anuncios": notificaciones in_app new_announcement
 * pendientes del user. Se marcan leídas al abrir la lista (MarkNotificationsRead).
 *
 * FIX E — el bucket "convocatorias" YA NO se cuenta aquí. Contar notificaciones
 * pending sin filtro temporal/pertenencia inflaba el badge con convocatorias de
 * eventos borrados o partidos ya jugados (badge decía 13/16 con la pantalla a 0).
 * Ahora el badge de convocatorias se deriva de la MISMA fuente que la pantalla
 * (loadUpcomingCallups), ver AppShell — así badge y contenido no divergen.
 */
async function loadAnnouncementBadge(
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<number> {
  const { data } = await supabase
    .from('notifications')
    .select('type')
    .eq('channel', 'in_app')
    .eq('status', 'pending')
    .eq('type', 'new_announcement');
  return data?.length ?? 0;
}

export async function AppShell({ ctx, locale, children, isSuperadmin = false }: Props) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // FIX E — el badge de convocatorias se cuenta con la MISMA resolución que la
  // pantalla /convocatorias (loadUpcomingCallups: evento vigente + ventana +
  // equipo del jugador con team_members.left_at IS NULL, por rol). Así "si la
  // pantalla muestra N, el badge dice N" y nunca cuenta eventos borrados/pasados.
  // rangeDays=30 = mismo valor que usa la página (convocatorias/page.tsx).
  const [unreadConversations, anunciosBadge, upcomingCallups] = await Promise.all([
    loadUnreadConversationsCount(supabase),
    loadAnnouncementBadge(supabase),
    loadUpcomingCallups(ctx.activeClub.club.id, ctx.activeClub.role, 30),
  ]);
  const badges = {
    mensajes: unreadConversations,
    convocatorias: upcomingCallups.length,
    anuncios: anunciosBadge,
  };

  // #9 — estado del colapso del menú lateral leído de la cookie en el servidor:
  // el atributo se renderiza ya correcto (sin flash de hidratación). El botón
  // (en la cabecera) lo alterna en cliente y persiste la cookie.
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1';

  // F14B-8 — banner de modo superadmin: solo si el club activo es un acceso
  // sintético (club ajeno). El "club propio" al que volver es la primera
  // membresía REAL (isPlatformAccess ausente).
  const isPlatformAccess = ctx.activeClub.isPlatformAccess === true;
  const ownClubId = ctx.clubs.find((c) => !c.isPlatformAccess)?.club.id ?? null;

  return (
    <div
      id="app-shell-root"
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      className="flex min-h-screen flex-col bg-background"
    >
      {isPlatformAccess && (
        <SuperadminBanner
          clubName={ctx.activeClub.club.name}
          ownClubId={ownClubId}
        />
      )}
      <Header
        user={ctx.user}
        fullName={ctx.profile.full_name}
        avatarPath={ctx.profile.avatar_url}
        clubs={ctx.clubs}
        activeClub={ctx.activeClub}
        locale={locale}
        badges={badges}
        sidebarCollapsed={sidebarCollapsed}
        isSuperadmin={isSuperadmin}
      />
      <div className="flex flex-1">
        <aside
          data-shell-sidebar
          className="hidden w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block"
        >
          <Sidebar
            role={ctx.activeClub.role}
            variant="desktop"
            badges={badges}
            isSuperadmin={isSuperadmin}
          />
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
