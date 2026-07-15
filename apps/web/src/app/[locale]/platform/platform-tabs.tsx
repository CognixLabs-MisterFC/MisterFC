'use client';

import { usePathname, Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Sub-nav de la consola de plataforma: Clubes (/platform) · Datos
 * (/platform/datos). `usePathname` de i18n devuelve la ruta SIN locale, así que
 * basta comparar con las rutas canónicas. Solo lectura; el guard vive en el layout.
 */
export function PlatformTabs({
  labels,
}: {
  labels: { clubs: string; data: string };
}) {
  const pathname = usePathname();
  const onData = pathname.startsWith('/platform/datos');

  const tabs = [
    { href: '/platform', label: labels.clubs, active: !onData },
    { href: '/platform/datos', label: labels.data, active: onData },
  ] as const;

  return (
    <nav className="flex gap-1 border-b border-zinc-800 bg-zinc-950 px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            'border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            tab.active
              ? 'border-misterfc-green text-misterfc-green'
              : 'border-transparent text-zinc-400 hover:text-zinc-100'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
