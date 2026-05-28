import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { UserRound } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreatePlayerDialog } from './create-player-dialog';

type Props = {
  params: Promise<{ locale: string }>;
};

const ROLES_THAT_CAN_MANAGE: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const mDiff = now.getUTCMonth() - d.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export default async function JugadoresPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('jugadores');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: rows } = await supabase
    .from('players')
    .select(
      'id, first_name, last_name, date_of_birth, dorsal, position_main'
    )
    .eq('club_id', ctx.activeClub.club.id)
    .order('last_name', { ascending: true });

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, category_id, categories!inner(club_id, season)')
    .eq('categories.club_id', ctx.activeClub.club.id);

  const teamsForDialog = (teamRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  const canManage = ROLES_THAT_CAN_MANAGE.includes(ctx.activeClub.role);
  const players = rows ?? [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('count', { count: players.length })}
          </p>
        </div>
        {canManage && <CreatePlayerDialog teams={teamsForDialog} />}
      </div>

      {players.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <UserRound
              className="size-10 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {players.map((p) => (
              <Link
                key={p.id}
                href={`/jugadores/${p.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {p.last_name}, {p.first_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('age_years', { age: ageFromDob(p.date_of_birth) })}
                    {p.position_main ? ` · ${t(`positions.${p.position_main}`)}` : ''}
                  </span>
                </div>
                {p.dorsal != null && (
                  <Badge variant="secondary">#{p.dorsal}</Badge>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
