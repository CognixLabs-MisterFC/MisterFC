import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { getHubChildren } from '@/components/shell/nav-config';
import { HubGrid } from '@/components/shell/hub-grid';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * HUB "Partidos": Gestión de partidos (convocatorias), Formaciones y Estadísticas
 * por equipo. Roles/hijos desde `nav-config` (misma fuente que el sidebar); las
 * rutas existentes no se mueven. El gating fino queda en cada ruta destino.
 */
export default async function PartidosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  const children = getHubChildren('partidos', role);
  if (children.length === 0) redirect(`/${locale}`);

  const t = await getTranslations('partidos');
  const items = children.map((c) => ({
    key: c.key,
    href: c.href,
    icon: c.icon,
    title: t(`cards.${c.key}.title`),
    description: t(`cards.${c.key}.description`),
  }));

  return <HubGrid title={t('title')} subtitle={t('subtitle')} items={items} />;
}
