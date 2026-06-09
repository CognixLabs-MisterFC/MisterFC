import { getTranslations } from 'next-intl/server';
import type { User } from '@supabase/supabase-js';
import type { CurrentUserClub } from '@misterfc/core';
import { ActiveClubSwitcher } from './active-club-switcher';
import { UserMenu } from './user-menu';
import { LogoutButton } from './logout-button';
import { MobileDrawer } from './mobile-drawer';
import { Sidebar } from './sidebar';
import { SidebarToggle } from './sidebar-toggle';
import { ProfileAvatar, initialsOf } from './avatar-image';

type Props = {
  user: User;
  fullName: string | null;
  avatarPath: string | null;
  clubs: CurrentUserClub[];
  activeClub: CurrentUserClub;
  locale: string;
  badges?: Partial<Record<string, number>>;
  /** #9 — estado inicial (desde cookie) del colapso del menú lateral. */
  sidebarCollapsed?: boolean;
};

export async function Header({
  user,
  fullName,
  avatarPath,
  clubs,
  activeClub,
  locale,
  badges,
  sidebarCollapsed = false,
}: Props) {
  const t = await getTranslations('shell');
  const fallback = initialsOf(fullName, user.email ?? '?');

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 text-zinc-100">
      <div className="flex items-center gap-2">
        <MobileDrawer
          triggerLabel={t('open_menu')}
          title={t('sidebar_label')}
        >
          <Sidebar role={activeClub.role} variant="mobile" badges={badges} />
        </MobileDrawer>

        {/* #9 — colapsar/mostrar el menú lateral (solo desktop). */}
        <SidebarToggle initialCollapsed={sidebarCollapsed} />

        <ActiveClubSwitcher
          clubs={clubs}
          activeClubId={activeClub.club.id}
          labels={{
            label: t('active_club_label'),
            switch_help: t('active_club_switch_help'),
          }}
        />
      </div>

      <UserMenu
        avatar={
          <ProfileAvatar
            path={avatarPath}
            fallback={fallback}
            className="size-9"
          />
        }
        fullName={fullName}
        email={user.email ?? ''}
        labels={{
          menu_label: t('user_menu_label'),
          perfil: t('user_menu_perfil'),
          signout: t('signout'),
        }}
        signoutForm={<LogoutButton locale={locale} variant="ghost" />}
      />
    </header>
  );
}
