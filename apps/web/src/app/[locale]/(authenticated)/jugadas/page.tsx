import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Plus, Swords } from 'lucide-react';
import { type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { loadPlays } from './queries';
import { PlayDeleteButton } from './_components/play-delete-button';

type Props = { params: Promise<{ locale: string }> };

const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/** Borrar jugada = autor∪admin/coord (la RLS es el gate real; aquí solo el UI). */
const DELETE_ANY_ROLES: ReadonlyArray<Role> = ['admin_club', 'coordinador'];

/**
 * F13.2a — Listado MÍNIMO de jugadas (la biblioteca completa con filtros es 13.5).
 * Solo staff. La RLS decide qué filas se ven; aquí solo se scopea al club activo.
 */
export default async function JugadasPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('jugadas');
  const plays = await loadPlays(ctx.activeClub.club.id);
  const canDeleteAny = DELETE_ANY_ROLES.includes(role);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/jugadas/nueva">
            <Plus className="size-4" aria-hidden />
            {t('new')}
          </Link>
        </Button>
      </div>

      {plays.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Swords className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {plays.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted"
            >
              <Link
                href={`/jugadas/${p.id}/editar`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name ?? t('untitled')}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.team_name ?? '—'} · {t('list.frame_count', { count: p.frame_count })}
                  </p>
                </div>
                <Badge variant={p.visibility === 'team' ? 'default' : 'secondary'}>
                  {t(`visibility.${p.visibility}`)}
                </Badge>
              </Link>
              {(canDeleteAny || p.is_owner) && (
                <PlayDeleteButton playId={p.id} playName={p.name} compact />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
