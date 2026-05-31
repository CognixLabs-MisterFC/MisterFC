import type { ReactNode } from 'react';
import { createSupabaseServerClient } from '@misterfc/core';
import type { ShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Sidebar } from './sidebar';
import { Header } from './header';

type Props = {
  ctx: ShellContext;
  locale: string;
  children: ReactNode;
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

export async function AppShell({ ctx, locale, children }: Props) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const unreadConversations = await loadUnreadConversationsCount(supabase);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        user={ctx.user}
        fullName={ctx.profile.full_name}
        avatarPath={ctx.profile.avatar_url}
        clubs={ctx.clubs}
        activeClub={ctx.activeClub}
        locale={locale}
        badges={{ mensajes: unreadConversations }}
      />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block">
          <Sidebar
            role={ctx.activeClub.role}
            variant="desktop"
            badges={{ mensajes: unreadConversations }}
          />
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
