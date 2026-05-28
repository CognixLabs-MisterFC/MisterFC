'use client';

import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type Props = {
  href: ComponentProps<typeof Link>['href'];
  icon: LucideIcon;
  label: string;
  onNavigate?: () => void;
};

/**
 * Entry del sidebar con resaltado del item activo.
 * Compara `usePathname()` (sin locale prefix) con `href`.
 */
export function SidebarNavLink({ href, icon: Icon, label, onNavigate }: Props) {
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
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
