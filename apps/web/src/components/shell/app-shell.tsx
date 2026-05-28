import type { ReactNode } from 'react';
import type { ShellContext } from '@/lib/auth-shell';
import { Sidebar } from './sidebar';
import { Header } from './header';

type Props = {
  ctx: ShellContext;
  locale: string;
  children: ReactNode;
};

export async function AppShell({ ctx, locale, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        user={ctx.user}
        fullName={ctx.profile.full_name}
        avatarPath={ctx.profile.avatar_url}
        clubs={ctx.clubs}
        activeClub={ctx.activeClub}
        locale={locale}
      />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block">
          <Sidebar role={ctx.activeClub.role} variant="desktop" />
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
