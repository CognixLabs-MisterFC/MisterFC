import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BarChart3 } from 'lucide-react';
import { requireSuperadmin } from '@/lib/platform/guard';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * Panel superadmin — DATOS agregados por club (una fila por club). Server
 * component: lee `platform_club_breakdown` (SECURITY DEFINER, gate is_superadmin).
 * El guard `requireSuperadmin` (redundante con el del layout) blinda la ruta.
 * Solo lectura. Personas por rol (jerarquía combinada, persona en su rol más
 * alto), familiares/seguidores activos y jugadores/equipos de la temporada activa.
 */
export default async function PlatformDataPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { supabase } = await requireSuperadmin(locale);
  const t = await getTranslations('platform');

  const { data: rows } = await supabase.rpc('platform_club_breakdown');
  const clubs = rows ?? [];

  // Columnas numéricas en orden de la jerarquía + separadas (familia/seguidor/equipos).
  const cols = [
    'admin_club',
    'director',
    'coordinador',
    'entrenador_principal',
    'segundo_entrenador',
    'preparador_fisico',
    'delegado',
    'jugadores',
    'familiares',
    'seguidores',
    'equipos',
  ] as const;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('data_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('data_subtitle')}</p>
      </div>

      {clubs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BarChart3 className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('clubs_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('data_title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card">
                      {t('table.club')}
                    </TableHead>
                    {cols.map((c) => (
                      <TableHead key={c} className="text-right whitespace-nowrap">
                        {t(`data_col.${c}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clubs.map((club) => (
                    <TableRow key={club.club_id}>
                      <TableCell className="sticky left-0 bg-card font-medium whitespace-nowrap">
                        {club.club_name}
                      </TableCell>
                      {cols.map((c) => (
                        <TableCell
                          key={c}
                          className="text-right tabular-nums"
                        >
                          {club[c] ?? 0}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
