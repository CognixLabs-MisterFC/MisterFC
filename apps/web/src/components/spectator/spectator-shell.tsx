import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { SpectatorContext } from '@/lib/spectator-shell';
import { MobileDrawer } from '@/components/shell/mobile-drawer';
import { UserMenu } from '@/components/shell/user-menu';
import { LogoutButton } from '@/components/shell/logout-button';
import { ProfileAvatar, initialsOf } from '@/components/shell/avatar-image';
import { SpectatorSidebar } from './spectator-sidebar';
import { FollowedPlayerSwitcher } from './followed-player-switcher';

type Props = {
  ctx: SpectatorContext;
  locale: string;
  children: ReactNode;
};

/**
 * F14C-4 — Shell del SEGUIDOR PURO. Cabecera con selector de nieto + menú de
 * usuario, y menú lateral REDUCIDO. NO reutiliza AppShell (que asume club/rol);
 * es su propia carcasa mínima, análoga a la de `/platform`.
 */
export async function SpectatorShell({ ctx, locale, children }: Props) {
  const t = await getTranslations('spectator');
  const tShell = await getTranslations('shell');
  const fallback = initialsOf(ctx.profile.full_name, ctx.user.email ?? '?');

  const switcherLabels = {
    label: t('active_player_label'),
    switch_help: t('active_player_switch_help'),
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 text-zinc-100">
        <div className="flex items-center gap-2">
          <MobileDrawer
            triggerLabel={tShell('open_menu')}
            title={t('sidebar_label')}
          >
            <SpectatorSidebar variant="mobile" />
          </MobileDrawer>

          <FollowedPlayerSwitcher
            players={ctx.players}
            activePlayerId={ctx.activePlayer.playerId}
            labels={switcherLabels}
          />
        </div>

        <UserMenu
          avatar={
            <ProfileAvatar
              path={ctx.profile.avatar_url}
              fallback={fallback}
              className="size-9"
            />
          }
          fullName={ctx.profile.full_name}
          email={ctx.user.email ?? ''}
          perfilHref="/spectator/perfil"
          labels={{
            menu_label: tShell('user_menu_label'),
            perfil: tShell('user_menu_perfil'),
            signout: tShell('signout'),
          }}
          signoutForm={<LogoutButton locale={locale} variant="ghost" />}
        />
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block">
          <SpectatorSidebar variant="desktop" />
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
