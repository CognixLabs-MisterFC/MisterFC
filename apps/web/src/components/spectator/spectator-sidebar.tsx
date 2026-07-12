import { getTranslations } from 'next-intl/server';
import { CalendarDays, Radio, BarChart3, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SidebarNavLink } from '@/components/shell/sidebar-nav-link';
import { cn } from '@/lib/utils';

/**
 * F14C-4 — Nav REDUCIDO del seguidor puro. Lista FIJA (no gateada por rol de
 * club: el seguidor no tiene rol). Nada de gestión/jugadores/médica/ajustes.
 */
const SPECTATOR_NAV: { key: string; href: string; icon: LucideIcon }[] = [
  { key: 'agenda', href: '/spectator/agenda', icon: CalendarDays },
  { key: 'directos', href: '/spectator/directos', icon: Radio },
  { key: 'estadisticas', href: '/spectator/estadisticas', icon: BarChart3 },
  { key: 'perfil', href: '/spectator/perfil', icon: UserRound },
];

export async function SpectatorSidebar({
  variant,
}: {
  variant: 'desktop' | 'mobile';
}) {
  const t = await getTranslations('spectator');

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

      {SPECTATOR_NAV.map((item) => {
        const Icon = item.icon;
        return (
          <SidebarNavLink
            key={item.key}
            href={item.href}
            icon={<Icon className="size-4 shrink-0" aria-hidden />}
            label={t(`nav.${item.key}`)}
          />
        );
      })}
    </nav>
  );
}
