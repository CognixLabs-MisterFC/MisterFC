import { setRequestLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireSuperadmin } from '@/lib/platform/guard';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ClubLogo } from '@/components/ui/club-logo';
import { CreateClubDialog } from './create-club-dialog';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * F14B-7 — LISTA de clubs de la consola (solo superadmin). Server component:
 * lee platform_list_clubs + platform_club_metrics y hace merge por club_id.
 * Cada fila enlaza a su detalle. Botón "Crear club" abre un Dialog.
 */
export default async function PlatformClubsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { supabase } = await requireSuperadmin(locale);
  const t = await getTranslations('platform');

  const [{ data: clubs }, { data: metrics }] = await Promise.all([
    supabase.rpc('platform_list_clubs'),
    supabase.rpc('platform_club_metrics'),
  ]);

  const metricsById = new Map((metrics ?? []).map((m) => [m.club_id, m]));

  // BC-8c — "sin administrador" se decide con el contador de `platform_club_metrics`,
  // que desde BC-8b cuenta SOLO miembros activos, y no con `platform_list_clubs.has_admin`,
  // que sigue mirando todas las memberships incluidas las de baja. La diferencia es
  // justo el caso de esta serie: un admin que borra su cuenta queda con `left_at`, así
  // que `has_admin` seguiría diciendo que sí. Un club sin métricas (no debería pasar:
  // las dos RPC leen de `clubs`) NO se marca como sin admin — mejor callar que acusar.
  const rows = (clubs ?? []).map((c) => {
    const m = metricsById.get(c.id);
    return { club: c, metrics: m, noAdmin: m != null && m.admin_club === 0 };
  });
  const clubsWithoutAdmin = rows.filter((r) => r.noAdmin);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('clubs_title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('clubs_count', { count: rows.length })}
          </p>
        </div>
        <CreateClubDialog locale={locale} />
      </div>

      {/* BC-8c — el badge de la fila no basta: hay que escanear la tabla para verlo.
          Este aviso es el sitio DURADERO del escalado que BC-7 manda a plataforma
          cuando un admin_club borra su cuenta. La novedad avisa una vez y se puede
          marcar leída; esto sigue ahí mientras el club no tenga administrador. */}
      {clubsWithoutAdmin.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-red-400">
              {t('no_admin_alert_title', { count: clubsWithoutAdmin.length })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('no_admin_alert_body', {
                clubs: clubsWithoutAdmin.map((r) => r.club.name).join(', '),
              })}
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('clubs_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('clubs_title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.club')}</TableHead>
                  <TableHead>{t('table.status')}</TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    {t('table.members')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    {t('table.players')}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell text-right">
                    {t('table.pending')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ club, metrics: m, noAdmin }) => (
                  <TableRow key={club.id}>
                    <TableCell>
                      <Link
                        href={`/platform/${club.id}`}
                        className="flex items-center gap-3 hover:underline"
                      >
                        <ClubLogo
                          path={club.logo_path}
                          name={club.name}
                          className="size-9"
                        />
                        <span className="flex flex-col">
                          <span className="font-medium">{club.name}</span>
                          <span className="text-xs text-muted-foreground">
                            /{club.slug}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {/* El rojo GANA: un club sin administrador activo no puede
                          presentarse como si tuviera owner, aunque `owner_profile_id`
                          siga apuntando a alguien. */}
                      {noAdmin ? (
                        <Badge variant="outline" className="text-red-400">
                          {t('status.no_admin')}
                        </Badge>
                      ) : club.has_owner ? (
                        <Badge variant="secondary">
                          {t('status.owner', { name: club.owner_name ?? '—' })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-400">
                          {t('status.no_owner')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {m?.members_total ?? 0}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {m?.players ?? 0}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right tabular-nums">
                      {m?.pending_invitations ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
