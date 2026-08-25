import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import {
  createSupabaseServerClient,
  getStaffConversationMessagesFromClient,
  markStaffConversationReadFromClient,
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
import { StaffMessageThread } from './staff-message-thread';

type Props = {
  params: Promise<{ locale: string; conversationId: string }>;
};

/**
 * O2-12 — Hilo 1:1 PRIVADO entre staff. Ruta propia (no toca el hilo de familia ni el
 * de equipo). La RLS `staff_conversations_select_participant` bloquea a los no
 * participantes → convRow null → notFound (una familia nunca es participante). Marca
 * leído antes del fetch (mismo patrón que el 1:1). Append-only: no edición/borrado.
 */
export default async function StaffConversationPage({ params }: Props) {
  const { locale, conversationId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('mensajes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: convRow } = await supabase
    .from('staff_conversations')
    .select('id, profile_a, profile_b')
    .eq('id', conversationId)
    .maybeSingle();
  if (!convRow) notFound();

  const otherId =
    convRow.profile_a === ctx.user.id ? convRow.profile_b : convRow.profile_a;
  const { data: otherProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', otherId)
    .maybeSingle();
  const title = (otherProfile?.full_name as string | null) ?? '';

  // Marca leído PRIMERO (upsert), como en el 1:1. La revalidación del badge la
  // dispara el thread tras montar (router.refresh()).
  await markStaffConversationReadFromClient(
    supabase,
    conversationId,
    ctx.user.id,
    new Date().toISOString(),
  );

  const messages = await getStaffConversationMessagesFromClient(
    supabase,
    conversationId,
  );

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
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <StaffMessageThread
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
