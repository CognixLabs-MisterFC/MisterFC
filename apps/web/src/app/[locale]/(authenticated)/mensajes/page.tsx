import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MessageSquare, UsersRound } from 'lucide-react';
import {
  createSupabaseServerClient,
  getInboxFromClient,
  getStaffInboxFromClient,
} from '@misterfc/core';
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
import { NewStaffChatDialog } from './new-staff-chat-dialog';
import { StaffInbox, type InboxListItem } from './staff-inbox';

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

  const items: InboxListItem[] = inbox.map((it): InboxListItem =>
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

  // O2-12 — SOLO para staff (canMessage): se añade el canal privado entre staff a la
  // MISMA bandeja, fusionado y ordenado por fecha, y se muestra en un componente
  // cliente con el filtro de 4. Con canMessage=false (familias) NO se consulta el
  // inbox de staff ni se cambia el render: se sirve exactamente la lista de siempre.
  let mergedItems: InboxListItem[] | null = null;
  if (canMessage) {
    const staffInbox = await getStaffInboxFromClient(supabase, ctx.user.id);
    mergedItems = [
      ...items,
      ...staffInbox.map(
        (it): InboxListItem => ({
          kind: 'staff',
          key: `s-${it.conversationId}`,
          href: `/mensajes/staff/${it.conversationId}`,
          title: it.title,
          last: it.lastMessageAt,
          unread: it.unread,
        }),
      ),
    ].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
  }

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
            <NewStaffChatDialog locale={locale} />
            <NewConversationDialog locale={locale} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canMessage && mergedItems ? (
            <StaffInbox locale={locale} items={mergedItems} />
          ) : items.length === 0 ? (
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
