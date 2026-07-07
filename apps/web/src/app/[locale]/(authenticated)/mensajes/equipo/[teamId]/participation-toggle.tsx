'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, Loader2, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setTeamChatParticipation, type TeamChatMode } from '../../actions';

type Props = { locale: string; teamId: string; mode: TeamChatMode };

/**
 * F5B-4 — Control de supervisión para director/admin: "Participar / Solo
 * observar" en el chat de un equipo. Escribe team_chat_participation y refresca
 * (el Server Component recalcula canPost → habilita/oculta el input). El gate
 * REAL es la RLS de team_messages; esto es la UI.
 */
export function ParticipationToggle({ locale, teamId, mode }: Props) {
  const t = useTranslations('mensajes.team_chat.participation');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = mode === 'active';

  function toggle() {
    const next: TeamChatMode = active ? 'observer' : 'active';
    startTransition(async () => {
      const res = await setTeamChatParticipation(locale, {
        team_id: teamId,
        mode: next,
      });
      if (res.ok) router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={toggle}
      disabled={pending}
      className="shrink-0 gap-2"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : active ? (
        <Eye className="size-4" aria-hidden />
      ) : (
        <MessageSquarePlus className="size-4" aria-hidden />
      )}
      <span>{active ? t('observe') : t('participate')}</span>
    </Button>
  );
}
