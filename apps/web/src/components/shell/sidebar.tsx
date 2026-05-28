import { getTranslations } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { SidebarNavLink } from './sidebar-nav-link';
import { navItemsForRole } from './nav-config';
import { cn } from '@/lib/utils';

type Props = {
  role: Role;
  variant: 'desktop' | 'mobile';
  /** Solo en mobile: invocado al navegar para cerrar el drawer. */
  onNavigate?: () => void;
};

export async function Sidebar({ role, variant }: Props) {
  const t = await getTranslations('shell');
  const items = navItemsForRole(role);

  return (
    <nav
      className={cn(
        'flex flex-col gap-1 p-3',
        variant === 'desktop' && 'h-full'
      )}
      aria-label={t('sidebar_label')}
    >
      <div className="px-3 pb-3 pt-1">
        <span className="text-2xl font-bold tracking-tight text-misterfc-green">
          {t('app_name')}
        </span>
      </div>

      {items.map((item) => (
        <SidebarNavLink
          key={item.key}
          href={item.href || '/'}
          icon={item.icon}
          label={t(`nav.${item.key}`)}
        />
      ))}
    </nav>
  );
}
