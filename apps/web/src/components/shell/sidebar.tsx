import { getTranslations } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { SidebarNavLink } from './sidebar-nav-link';
import { navEntriesForRole, isNavSection, type NavItem } from './nav-config';
import { cn } from '@/lib/utils';

type Props = {
  role: Role;
  variant: 'desktop' | 'mobile';
  /** Solo en mobile: invocado al navegar para cerrar el drawer. */
  onNavigate?: () => void;
  /**
   * Conteos opcionales por nav key para renderizar badge. Hoy solo
   * 'mensajes' (Feature F). Si el badge no aplica para una entrada, la
   * key simplemente no aparece en el record.
   */
  badges?: Partial<Record<string, number>>;
};

export async function Sidebar({ role, variant, badges }: Props) {
  const t = await getTranslations('shell');
  const entries = navEntriesForRole(role);

  // El icono se resuelve aquí en el server y se pasa como ReactNode ya resuelto.
  // Pasar la función `icon` directamente cruzaría la frontera RSC (lucide es
  // forwardRef) y rompería el render ("Functions cannot be passed...").
  function renderLink(item: NavItem) {
    const Icon = item.icon;
    return (
      <SidebarNavLink
        key={item.key}
        href={item.href || '/'}
        icon={<Icon className="size-4 shrink-0" aria-hidden />}
        label={t(`nav.${item.key}`)}
        badge={badges?.[item.key]}
      />
    );
  }

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

      {entries.map((entry) => {
        if (isNavSection(entry)) {
          const SectionIcon = entry.icon;
          return (
            <div key={entry.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 px-3 pb-0.5 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <SectionIcon className="size-3.5 shrink-0" aria-hidden />
                {t(`nav.${entry.key}`)}
              </div>
              <div className="flex flex-col gap-1 border-l border-border/60 pl-2">
                {entry.items.map(renderLink)}
              </div>
            </div>
          );
        }
        return renderLink(entry);
      })}
    </nav>
  );
}
