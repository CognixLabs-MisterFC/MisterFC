import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MessageSquare, UsersRound } from 'lucide-react';
import { createSupabaseServerClient, formatPlayerName } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { userCanMessageInClub } from '@/lib/messaging-permissions';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NewConversationDialog } from './new-conversation-dialog';
import { NewTeamChatDialog } from './new-team-chat-dialog';

type Props = { params: Promise<{ locale: string }> };

export default async function MensajesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('mensajes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ¿Puede el user iniciar chats? Mismo criterio que el botón de la ficha del
  // jugador (admin/coord/principal por rol; ayudante con cap o principal de team).
  const canMessage = await userCanMessageInClub(supabase, ctx);

  // RLS conversations_select_participants ya filtra a las del user.
  const { data: conversationRows } = await supabase
    .from('conversations')
    .select(
      'id, last_message_at, coach_profile_id, players!inner(id, first_name, last_name)',
    )
    .order('last_message_at', { ascending: false });

  type ConversationRow = {
    id: string;
    last_message_at: string;
    coach_profile_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
    };
  };

  const conversations =
    (conversationRows ?? []) as unknown as ConversationRow[];

  // Para cada conversación, contar mensajes no leídos por el user actual.
  // Una sola query agregada por simplicidad inicial; si crece, optimizar.
  const ids = conversations.map((c) => c.id);
  const unreadByConvId = new Map<string, number>();
  if (ids.length > 0) {
    const { data: unreadRows } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', ids)
      .is('read_at', null)
      .neq('sender_profile_id', ctx.user.id);
    for (const m of unreadRows ?? []) {
      const id = (m as { conversation_id: string }).conversation_id;
      unreadByConvId.set(id, (unreadByConvId.get(id) ?? 0) + 1);
    }
  }

  // F5B-3 — Chats de EQUIPO (grupo). La RLS de team_conversations filtra a los
  // grupos de los que el user es miembro (staff ∪ roster vigente ∪ director del
  // club).
  const { data: teamConvRows } = await supabase
    .from('team_conversations')
    .select('id, team_id, last_message_at, teams!inner(name)')
    .order('last_message_at', { ascending: false });

  type TeamConvRow = {
    id: string;
    team_id: string;
    last_message_at: string;
    teams: { name: string };
  };
  const teamConversations =
    (teamConvRows ?? []) as unknown as TeamConvRow[];

  // F5B-5 — No-leídos por grupo. El RPC (SECURITY DEFINER, acotado a auth.uid())
  // cuenta team_messages no propios posteriores a la marca de lectura del user,
  // SOLO en los chats donde participa (staff/jugador siempre; director solo si
  // 'active' — un director que solo observa NO acumula badges). Los grupos sin
  // no-leídos no vienen en el resultado (se tratan como 0).
  const unreadByTeamConvId = new Map<string, number>();
  const { data: teamUnreadRows } = await supabase.rpc(
    'team_chat_unread_counts',
  );
  for (const r of teamUnreadRows ?? []) {
    unreadByTeamConvId.set(r.team_conversation_id, r.unread);
  }

  // Lista unificada 1:1 + grupo, ordenada por actividad reciente.
  type ListItem = {
    kind: 'direct' | 'group';
    key: string;
    href: string;
    title: string;
    last: string;
    unread: number;
  };

  const items: ListItem[] = [
    ...conversations.map((c): ListItem => ({
      kind: 'direct',
      key: `d-${c.id}`,
      href: `/mensajes/${c.id}`,
      title: formatPlayerName(c.players.first_name, c.players.last_name),
      last: c.last_message_at,
      unread: unreadByConvId.get(c.id) ?? 0,
    })),
    ...teamConversations.map((tc): ListItem => ({
      kind: 'group',
      key: `g-${tc.id}`,
      href: `/mensajes/equipo/${tc.team_id}`,
      title: tc.teams?.name ?? '',
      last: tc.last_message_at,
      unread: unreadByTeamConvId.get(tc.id) ?? 0,
    })),
  ].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MessageSquare className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        {canMessage && (
          <div className="flex items-center gap-2">
            <NewTeamChatDialog locale={locale} />
            <NewConversationDialog locale={locale} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      {item.kind === 'group' && (
                        <UsersRound
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {item.kind === 'group'
                            ? t('list.group_label', { team: item.title })
                            : item.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.last).toLocaleString(locale)}
                        </span>
                      </div>
                    </div>
                    {item.unread > 0 && (
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-misterfc-green px-2 text-xs font-semibold text-zinc-900">
                        {item.unread}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
