import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2 } from 'lucide-react';
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
  const rows = (clubs ?? []).map((c) => ({ club: c, metrics: metricsById.get(c.id) }));

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
                {rows.map(({ club, metrics: m }) => (
                  <TableRow key={club.id}>
                    <TableCell>
                      <Link
                        href={`/platform/${club.id}`}
                        className="flex flex-col hover:underline"
                      >
                        <span className="font-medium">{club.name}</span>
                        <span className="text-xs text-muted-foreground">
                          /{club.slug}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {club.has_owner ? (
                        <Badge variant="secondary">
                          {t('status.owner', { name: club.owner_name ?? '—' })}
                        </Badge>
                      ) : club.has_admin ? (
                        <Badge variant="outline" className="text-amber-400">
                          {t('status.no_owner')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-400">
                          {t('status.no_admin')}
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
