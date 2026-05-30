'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startConversation } from '../../mensajes/actions';

type Props = {
  locale: string;
  playerId: string;
};

/**
 * Botón que abre (o reusa) la conversación 1:1 entre el coach actual y este
 * jugador. Llama a `startConversation` y redirige al hilo.
 */
export function SendMessageButton({ locale, playerId }: Props) {
  const t = useTranslations('mensajes.start');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await startConversation(locale, { player_id: playerId });
      if (res.ok) {
        router.push(`/${locale}/mensajes/${res.ok.conversation_id}`);
      }
      // En caso de error mostramos toast en versiones futuras; F5 Lote A
      // mantiene UI simple (los casos forbidden/player_not_in_club no
      // deberían disparase desde la ficha porque solo se renderiza el
      // botón si el user es staff).
    });
  }

  return (
    <Button onClick={onClick} variant="outline" size="sm" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <MessageSquare className="size-4" aria-hidden />
      )}
      <span>{t('action')}</span>
    </Button>
  );
}
