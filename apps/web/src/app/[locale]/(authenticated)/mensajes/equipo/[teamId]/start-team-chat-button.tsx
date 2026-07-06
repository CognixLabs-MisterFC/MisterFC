'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createTeamConversation } from '../../actions';

type Props = { locale: string; teamId: string };

/**
 * F5B-3 — Inicia el hilo de grupo del equipo (crea si no existe). Solo se
 * renderiza cuando el user puede crearlo (staff/dirección); la RLS es la
 * autoridad final. Tras crear, refresca la página del hilo.
 */
export function StartTeamChatButton({ locale, teamId }: Props) {
  const t = useTranslations('mensajes.team_chat');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await createTeamConversation(locale, teamId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(t('start_error'));
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={onClick} disabled={pending} className="gap-2">
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <MessagesSquare className="size-4" aria-hidden />
        )}
        <span>{t('start_action')}</span>
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
