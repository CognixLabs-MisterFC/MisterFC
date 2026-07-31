import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import {
  createSupabaseServerClient,
  formatPlayerName,
  getConversationMessagesFromClient,
  markConversationReadFromClient,
} from '@misterfc/core';
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
import { MessageThread } from './message-thread';

type Props = {
  params: Promise<{ locale: string; conversationId: string }>;
};

export default async function ConversationPage({ params }: Props) {
  const { locale, conversationId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('mensajes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // RLS bloquea si el user no es participant — devuelve null en ese caso.
  const { data: convRow } = await supabase
    .from('conversations')
    .select(
      'id, coach_profile_id, players!inner(id, first_name, last_name)',
    )
    .eq('id', conversationId)
    .maybeSingle();
  if (!convRow) notFound();

  type ConvRow = {
    id: string;
    coach_profile_id: string;
    players: { id: string; first_name: string; last_name: string | null };
  };
  const conv = convRow as unknown as ConvRow;

  // Marca como leídos PRIMERO los mensajes recibidos por este user, para
  // que el SELECT que sigue ya los devuelva con read_at poblado y la UI
  // los pinte como leídos en el primer render. Inline (sin server action)
  // porque Next.js 16 prohíbe revalidatePath durante render — la
  // revalidación del badge en el sidebar la dispara MessageThread tras
  // mount via router.refresh() (Bug I).
  // O2-5 E2a — marcar leído + fetch extraídos a core (misma query + RLS). Idéntico.
  await markConversationReadFromClient(
    supabase,
    conversationId,
    ctx.user.id,
    new Date().toISOString(),
  );

  const messages = await getConversationMessagesFromClient(
    supabase,
    conversationId,
  );

  const playerName = formatPlayerName(conv.players.first_name, conv.players.last_name);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/mensajes">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_list')}</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{playerName}</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageThread
            locale={locale}
            conversationId={conversationId}
            currentUserId={ctx.user.id}
            initialMessages={messages}
          />
        </CardContent>
      </Card>
    </div>
  );
}
