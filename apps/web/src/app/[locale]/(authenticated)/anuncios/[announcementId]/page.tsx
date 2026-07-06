import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Globe, Megaphone, Pin } from 'lucide-react';
import { createSupabaseServerClient, MANAGER_ROLES } from '@misterfc/core';
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
import { DeleteAnnouncementButton } from './delete-announcement-button';

type Props = {
  params: Promise<{ locale: string; announcementId: string }>;
};

export default async function AnnouncementDetailPage({ params }: Props) {
  const { locale, announcementId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('anuncios_global.detail');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: row } = await supabase
    .from('announcements')
    .select(
      'id, title, body, pinned, expires_at, created_at, team_id, club_id, author_profile_id, teams(name), profiles!inner(full_name)',
    )
    .eq('id', announcementId)
    .maybeSingle();

  if (!row) notFound();
  type Ann = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    expires_at: string | null;
    created_at: string;
    team_id: string | null;
    club_id: string;
    author_profile_id: string;
    teams: { name: string } | null;
    profiles: { full_name: string | null };
  };
  const a = row as unknown as Ann;
  if (a.club_id !== ctx.activeClub.club.id) notFound();

  const isAuthor = a.author_profile_id === ctx.user.id;
  const isManager = MANAGER_ROLES.includes(ctx.activeClub.role);
  const canDelete = isAuthor || isManager;

  // eslint-disable-next-line react-hooks/purity
  const expired = a.expires_at !== null && new Date(a.expires_at).getTime() < Date.now();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/anuncios">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Megaphone className="size-5" aria-hidden />
              <CardTitle className="text-2xl">{a.title}</CardTitle>
              {a.pinned && (
                <Pin className="size-4 text-misterfc-green" aria-hidden />
              )}
              {a.team_id === null && (
                <span className="flex items-center gap-1 rounded bg-misterfc-green/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-misterfc-green">
                  <Globe className="size-3" aria-hidden />
                  {t('club_wide')}
                </span>
              )}
              {expired && (
                <span className="text-xs text-muted-foreground">{t('expired')}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {a.team_id ? a.teams?.name ?? '—' : t('club_wide')}
              {' · '}
              {a.profiles.full_name ?? '—'}
              {' · '}
              {new Date(a.created_at).toLocaleString(locale)}
            </p>
          </div>
          {canDelete && (
            <DeleteAnnouncementButton
              announcementId={a.id}
              teamId={a.team_id}
              locale={locale}
            />
          )}
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {a.body}
          </p>
          {a.expires_at && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t('expires_at')}: {new Date(a.expires_at).toLocaleString(locale)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
