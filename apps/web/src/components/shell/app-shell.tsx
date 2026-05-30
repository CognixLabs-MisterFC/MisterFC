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
 * actual. NO el total de mensajes — eso se vería como "spam" en el badge
 * cuando hay un hilo con muchas líneas. Aprox: 1 conversación con N
 * unreads = 1 en el badge.
 *
 * RLS de messages filtra ya por participant; un SELECT sobre messages
 * unleídos no propios devuelve solo los que el user debería contar.
 */
async function loadUnreadConversationsCount(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from('messages')
    .select('conversation_id')
    .is('read_at', null)
    .neq('sender_profile_id', userId);
  if (!data) return 0;
  return new Set(data.map((m) => m.conversation_id)).size;
}

export async function AppShell({ ctx, locale, children }: Props) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const unreadConversations = await loadUnreadConversationsCount(supabase, ctx.user.id);

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
