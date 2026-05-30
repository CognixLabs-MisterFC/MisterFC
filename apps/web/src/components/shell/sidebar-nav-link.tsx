'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type Props = {
  href: ComponentProps<typeof Link>['href'];
  /**
   * Icono ya renderizado como JSX por el server. NO aceptamos `LucideIcon`
   * (una función) porque cruzar la frontera RSC con una función rompe el
   * render — ver fix en `Sidebar` que renderiza el icono ahí.
   */
  icon: ReactNode;
  label: string;
  onNavigate?: () => void;
  /** Badge numérico opcional (ej. mensajes no leídos). Solo se pinta si > 0. */
  badge?: number;
};

/**
 * Entry del sidebar con resaltado del item activo.
 * Compara `usePathname()` (sin locale prefix) con `href`.
 */
export function SidebarNavLink({ href, icon, label, onNavigate, badge }: Props) {
  const pathname = usePathname();
  const target = typeof href === 'string' ? href : href.pathname;
  const isHome = target === '' || target === '/';
  const active = isHome
    ? pathname === '/'
    : pathname === target || pathname.startsWith(target + '/');

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-misterfc-green/15 text-misterfc-green'
          : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          aria-label={String(badge)}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-misterfc-green px-1.5 text-[10px] font-bold text-zinc-900"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
