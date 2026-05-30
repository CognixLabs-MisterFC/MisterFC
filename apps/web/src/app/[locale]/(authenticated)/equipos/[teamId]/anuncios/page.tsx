import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Megaphone, Pin } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnnouncementForm } from './announcement-form';
import { AnnouncementActions } from './announcement-actions';
import { userCanPublishAnnouncementsToTeam } from '@/lib/messaging-permissions';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

export default async function AnunciosPage({ params }: Props) {
  const { locale, teamId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('anuncios');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: teamRow } = await supabase
    .from('teams')
    .select('id, name, category_id, categories!inner(name, season, club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!teamRow) notFound();
  const team = teamRow as unknown as {
    id: string;
    name: string;
    category_id: string;
    categories: { name: string; season: string; club_id: string };
  };
  if (team.categories.club_id !== ctx.activeClub.club.id) notFound();

  // canPublish considera memberships.role + capability + team_staff.staff_role
  // del team específico. Caso real F2.6: ayudante club que es principal via
  // team_staff de ESTE team debe poder publicar aunque su cap esté off.
  const canPublish = await userCanPublishAnnouncementsToTeam(supabase, ctx, teamId);

  const { data: announcementRows } = await supabase
    .from('announcements')
    .select(
      'id, title, body, pinned, expires_at, created_at, author_profile_id, profiles!inner(full_name)',
    )
    .eq('team_id', teamId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  type Announcement = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    expires_at: string | null;
    created_at: string;
    author_profile_id: string;
    profiles: { full_name: string | null };
  };
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const announcements = ((announcementRows ?? []) as unknown as Announcement[]).map(
    (a) => ({
      ...a,
      expired: a.expires_at !== null && new Date(a.expires_at).getTime() < nowMs,
    }),
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/equipos/${teamId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Megaphone className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {team.name} · {team.categories.name} · {team.categories.season}
          </p>
        </div>
      </div>

      {canPublish && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AnnouncementForm locale={locale} teamId={teamId} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {announcements.map((a) => {
                const isAuthor = a.author_profile_id === ctx.user.id;
                const canManage = isAuthor || canPublish;
                return (
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
                          {a.profiles.full_name ?? '—'} ·{' '}
                          {new Date(a.created_at).toLocaleString(locale)}
                        </p>
                      </div>
                      {canManage && (
                        <AnnouncementActions
                          locale={locale}
                          announcementId={a.id}
                          teamId={teamId}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
