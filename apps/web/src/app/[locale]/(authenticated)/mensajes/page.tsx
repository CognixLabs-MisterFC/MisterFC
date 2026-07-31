import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MessageSquare, UsersRound } from 'lucide-react';
import { createSupabaseServerClient, getInboxFromClient } from '@misterfc/core';
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

  // O2-5 E2a — inbox (1:1 + equipo, no-leídos, fusionado y ordenado) extraído a
  // core para compartirlo con la app nativa. Comportamiento idéntico; aquí solo
  // se mapea a la forma de la lista (href/rótulo) de la web.
  const inbox = await getInboxFromClient(supabase, ctx.user.id);

  type ListItem = {
    kind: 'direct' | 'group';
    key: string;
    href: string;
    title: string;
    last: string;
    unread: number;
  };

  const items: ListItem[] = inbox.map((it): ListItem =>
    it.kind === 'direct'
      ? {
          kind: 'direct',
          key: `d-${it.conversationId}`,
          href: `/mensajes/${it.conversationId}`,
          title: it.title,
          last: it.lastMessageAt,
          unread: it.unread,
        }
      : {
          kind: 'group',
          key: `g-${it.teamConversationId}`,
          href: `/mensajes/equipo/${it.teamId}`,
          title: it.title,
          last: it.lastMessageAt,
          unread: it.unread,
        },
  );

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
