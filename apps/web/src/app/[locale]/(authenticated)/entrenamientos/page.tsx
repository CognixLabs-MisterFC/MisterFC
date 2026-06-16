import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Dumbbell, ClipboardCheck, ChevronRight, type LucideIcon } from 'lucide-react';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * F11.6 — HUB "Entrenamientos". Una sola entrada en el sidebar; aquí se presentan
 * las sub-áreas como tarjetas. Cada tarjeta preserva el gating de su sub-área (el
 * guard real sigue en la ruta de destino). Para añadir más adelante (Sesiones de
 * F12, etc.) basta con ampliar HUB_CARDS — sin tocar el sidebar.
 */
type HubCard = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Roles que ven la tarjeta = mismo criterio de acceso que la sub-área. */
  roles: ReadonlyArray<Role>;
};

const STAFF: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

const HUB_CARDS: ReadonlyArray<HubCard> = [
  {
    // Biblioteca de ejercicios (F11). Solo staff (igual que /ejercicios).
    key: 'ejercicios',
    href: '/ejercicios',
    icon: Dumbbell,
    roles: STAFF,
  },
  {
    // Asistencia: vive aquí porque se confirma para los entrenamientos. La ruta
    // y su guard quedan donde están; solo se reubica el acceso al hub. Visible a
    // los mismos roles que hoy ven asistencia (incluye jugador/familia).
    key: 'asistencia',
    href: '/asistencia',
    icon: ClipboardCheck,
    roles: [...STAFF, 'jugador'],
  },
];

export default async function EntrenamientosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  const cards = HUB_CARDS.filter((c) => c.roles.includes(role));
  // Sin sub-áreas accesibles → fuera (no debería pasar: asistencia la ve todo rol).
  if (cards.length === 0) redirect(`/${locale}`);

  const t = await getTranslations('entrenamientos');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.key} className="transition-colors hover:border-foreground/30">
              <Link href={c.href} className="block">
                <CardContent className="flex items-center gap-4 py-5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-5 text-foreground" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t(`cards.${c.key}.title`)}</p>
                    <p className="text-sm text-muted-foreground">
                      {t(`cards.${c.key}.description`)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </CardContent>
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
