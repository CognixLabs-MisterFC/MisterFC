import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@misterfc/core';
import type { ShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { SIDEBAR_COLLAPSED_COOKIE } from './sidebar-toggle';

type Props = {
  ctx: ShellContext;
  locale: string;
  children: ReactNode;
  /** F14B-7 — muestra el enlace a la consola de plataforma (solo superadmin). */
  isSuperadmin?: boolean;
};

/**
 * Cuenta el número de CONVERSACIONES con mensajes no leídos para el user
 * actual via RPC SECURITY DEFINER (`user_unread_conversations_count`).
 *
 * Bug M (PR #32): la query directa sobre `messages` con `.is(read_at,null)
 * .neq(sender_profile_id, user_id)` no devolvía filas para admin_club en
 * runtime — el badge salía en 0. La RPC hace el predicate de participante
 * inline (sin pasar por la RLS de messages) y devuelve un único int. Más
 * robusto y más barato (el planner hace count distinct + join, en lugar
 * de scan + dedupe en JS).
 */
async function loadUnreadConversationsCount(
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<number> {
  const { data } = await supabase.rpc('user_unread_conversations_count');
  if (typeof data !== 'number') return 0;
  return data;
}

/**
 * PART 3.4 — badge verde por tipo de notificación in_app pendiente. callup_*
 * (publicada/actualizada) se acumula en "convocatorias"; new_announcement en
 * "anuncios". Se marcan leídas al abrir la lista (MarkNotificationsRead).
 */
async function loadNotificationBadges(
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<{ convocatorias: number; anuncios: number }> {
  const { data } = await supabase
    .from('notifications')
    .select('type')
    .eq('channel', 'in_app')
    .eq('status', 'pending');
  let convocatorias = 0;
  let anuncios = 0;
  for (const row of data ?? []) {
    const type = row.type as string;
    if (type === 'callup_published' || type === 'callup_updated') {
      convocatorias += 1;
    } else if (type === 'new_announcement') {
      anuncios += 1;
    }
  }
  return { convocatorias, anuncios };
}

export async function AppShell({ ctx, locale, children, isSuperadmin = false }: Props) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const [unreadConversations, notifBadges] = await Promise.all([
    loadUnreadConversationsCount(supabase),
    loadNotificationBadges(supabase),
  ]);
  const badges = {
    mensajes: unreadConversations,
    convocatorias: notifBadges.convocatorias,
    anuncios: notifBadges.anuncios,
  };

  // #9 — estado del colapso del menú lateral leído de la cookie en el servidor:
  // el atributo se renderiza ya correcto (sin flash de hidratación). El botón
  // (en la cabecera) lo alterna en cliente y persiste la cookie.
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1';

  return (
    <div
      id="app-shell-root"
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      className="flex min-h-screen flex-col bg-background"
    >
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
