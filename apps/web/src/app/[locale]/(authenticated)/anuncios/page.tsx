import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Megaphone, Pin, Globe } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GlobalAnnouncementForm } from './global-announcement-form';

type Props = { params: Promise<{ locale: string }> };

const ALLOWED_ROLES: ReadonlyArray<string> = ['admin_club', 'coordinador'];

export default async function AnunciosGlobalesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.includes(ctx.activeClub.role)) redirect(`/${locale}`);

  const t = await getTranslations('anuncios_global');

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Teams del club (para multi-select).
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, categories!inner(name, season, club_id)')
    .eq('categories.club_id', clubId)
    .order('name', { ascending: true });
  type TeamRow = {
    id: string;
    name: string;
    categories: { name: string; season: string; club_id: string };
  };
  const teams = (teamRows ?? []) as unknown as TeamRow[];

  // Anuncios recientes del club (todos: team-bound + club-wide).
  const { data: annRows } = await supabase
    .from('announcements')
    .select('id, title, body, pinned, expires_at, created_at, team_id, teams(name)')
    .eq('club_id', clubId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);
  type Ann = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    expires_at: string | null;
    created_at: string;
    team_id: string | null;
    teams: { name: string } | null;
  };
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const announcements = ((annRows ?? []) as unknown as Ann[]).map((a) => ({
    ...a,
    expired: a.expires_at !== null && new Date(a.expires_at).getTime() < nowMs,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Megaphone className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('form.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <GlobalAnnouncementForm
            locale={locale}
            teams={teams.map((t) => ({
              id: t.id,
              name: `${t.name} · ${t.categories.name}`,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className={`rounded-md border p-3 ${
                    a.pinned
                      ? 'border-misterfc-green bg-emerald-950/20'
                      : 'border-zinc-800 bg-zinc-900/50'
                  } ${a.expired ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-2">
                        {a.pinned && (
                          <Pin className="size-3 text-misterfc-green" aria-hidden />
                        )}
                        <h3 className="font-semibold">{a.title}</h3>
                        {a.team_id === null && (
                          <span className="flex items-center gap-1 rounded bg-misterfc-green/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-misterfc-green">
                            <Globe className="size-3" aria-hidden />
                            {t('badge.club_wide')}
                          </span>
                        )}
                        {a.expired && (
                          <span className="text-xs text-muted-foreground">
                            {t('list.expired')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {a.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {a.team_id ? a.teams?.name ?? '—' : t('badge.club_wide')}
                        {' · '}
                        {new Date(a.created_at).toLocaleString(locale)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
