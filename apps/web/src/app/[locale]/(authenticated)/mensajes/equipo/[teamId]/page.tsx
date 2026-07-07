import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Users } from 'lucide-react';
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
import { TeamMessageThread, type TeamMessage } from './team-message-thread';
import { StartTeamChatButton } from './start-team-chat-button';
import { ParticipationToggle } from './participation-toggle';

type Props = {
  params: Promise<{ locale: string; teamId: string }>;
};

/**
 * F5B-3 — Vista del chat de grupo de un equipo. GET sin efectos: si el hilo no
 * existe, muestra "iniciar" (staff/dirección) o "aún no iniciado" (miembro sin
 * permiso de creación). La RLS filtra todo por pertenencia derivada (F5B-2).
 */
export default async function TeamChatPage({ params }: Props) {
  const { locale, teamId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('mensajes');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Equipo + validación de club (aislamiento).
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) notFound();
  const teamClubId = (team as unknown as { categories: { club_id: string } })
    .categories.club_id;
  if (teamClubId !== clubId) notFound();
  const teamName = (team as unknown as { name: string }).name;

  // Hilo del equipo (RLS: solo miembro lo ve).
  const { data: convRow } = await supabase
    .from('team_conversations')
    .select('id')
    .eq('team_id', teamId)
    .maybeSingle();

  const header = (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href="/mensajes">
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t('back_to_list')}</span>
        </Link>
      </Button>
    </div>
  );

  const title = (
    <CardTitle className="flex items-center gap-2">
      <Users className="size-5" aria-hidden />
      {t('team_chat.title', { team: teamName })}
    </CardTitle>
  );

  if (!convRow) {
    // No existe aún. ¿Puede el user crearlo? staff del equipo o admin/director
    // del club activo (== user_is_admin_or_director para este club).
    const { data: isStaff } = await supabase.rpc('user_is_staff_of_team', {
      p_team_id: teamId,
    });
    const isAdminDir =
      ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';
    const canStart = Boolean(isStaff) || isAdminDir;

    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {header}
        <Card>
          <CardHeader>{title}</CardHeader>
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t('team_chat.not_started')}
            </p>
            {canStart && <StartTeamChatButton locale={locale} teamId={teamId} />}
          </CardContent>
        </Card>
      </div>
    );
  }

  const conversationId = (convRow as { id: string }).id;

  // F5B-4 — Supervisión. Para admin/director: modo de participación (default
  // observer sin fila) y si puede escribir (participación 'active'). Staff y
  // jugadores no usan esto: pueden escribir siempre (canPost=true).
  const isAdminDir =
    ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';
  let participationMode: 'observer' | 'active' = 'observer';
  let canPost = true;
  if (isAdminDir) {
    const { data: partRow } = await supabase
      .from('team_chat_participation')
      .select('mode')
      .eq('profile_id', ctx.user.id)
      .eq('team_id', teamId)
      .maybeSingle();
    participationMode =
      ((partRow as { mode: string } | null)?.mode as 'observer' | 'active') ??
      'observer';
    const { data: canPostData } = await supabase.rpc('user_can_post_team_chat', {
      p_team_id: teamId,
    });
    canPost = Boolean(canPostData);
  }

  const { data: messageRows } = await supabase
    .from('team_messages')
    .select('id, sender_profile_id, body, created_at, profiles!inner(full_name)')
    .eq('team_conversation_id', conversationId)
    .order('created_at', { ascending: true });

  type Row = {
    id: string;
    sender_profile_id: string;
    body: string;
    created_at: string;
    profiles: { full_name: string | null };
  };
  const messages: TeamMessage[] = (
    (messageRows ?? []) as unknown as Row[]
  ).map((m) => ({
    id: m.id,
    sender_profile_id: m.sender_profile_id,
    sender_name: m.profiles?.full_name ?? '',
    body: m.body,
    created_at: m.created_at,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {header}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          {title}
          {isAdminDir && (
            <ParticipationToggle
              locale={locale}
              teamId={teamId}
              mode={participationMode}
            />
          )}
        </CardHeader>
        <CardContent>
          <TeamMessageThread
            locale={locale}
            teamConversationId={conversationId}
            currentUserId={ctx.user.id}
            initialMessages={messages}
            canPost={canPost}
          />
        </CardContent>
      </Card>
    </div>
  );
}
