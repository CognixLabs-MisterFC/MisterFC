import { getTranslations } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import type { Role } from '@misterfc/core';
import { SidebarNavLink } from './sidebar-nav-link';
import { resolveNav } from './nav-config';
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
  /**
   * F14B-7 — el superadmin ve un enlace extra a la consola de plataforma
   * (`/platform`). NO es un rol de club, por eso va aquí y no en nav-config.
   */
  isSuperadmin?: boolean;
};

export async function Sidebar({ role, variant, badges, isSuperadmin }: Props) {
  const t = await getTranslations('shell');
  const items = resolveNav(role);

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

      {/* F14E-1 — Consola de plataforma: PRIMERA entrada del superadmin (antes de
          Inicio). No es rol de club, por eso el gate es el flag isSuperadmin. */}
      {isSuperadmin && (
        <SidebarNavLink
          href="/platform"
          icon={<ShieldCheck className="size-4 shrink-0" aria-hidden />}
          label={t('nav.platform')}
        />
      )}

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <SidebarNavLink
            key={item.key}
            href={item.href || '/'}
            // El icono se renderiza aquí en el server y se pasa como ReactNode
            // ya resuelto. Pasar `item.icon` directamente cruzaría la frontera
            // RSC con una función (lucide es forwardRef) y rompería el render
            // con "Functions cannot be passed directly to Client Components".
            icon={<Icon className="size-4 shrink-0" aria-hidden />}
            label={t(`nav.${item.key}`)}
            badge={badges?.[item.key]}
          />
        );
      })}
    </nav>
  );
}
