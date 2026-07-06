'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sendTeamMessage } from '../../actions';

export type TeamMessage = {
  id: string;
  sender_profile_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

type Props = {
  locale: string;
  teamConversationId: string;
  currentUserId: string;
  initialMessages: TeamMessage[];
};

/**
 * F5B-3 — Hilo del chat de EQUIPO (grupo). Mismo patrón que el 1:1
 * (message-thread.tsx): render server + optimistic UI + router.refresh() al
 * montar. Diferencia: hay VARIOS remitentes, así que se muestra el nombre del
 * emisor sobre cada burbuja ajena. Sin polling (F5B-3b); el push cubre el
 * "tiempo real" práctico.
 */
export function TeamMessageThread({
  locale,
  teamConversationId,
  currentUserId,
  initialMessages,
}: Props) {
  const t = useTranslations('mensajes');
  const router = useRouter();
  const [messages, setMessages] = useState<TeamMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const didRefreshLayoutRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // Igual que el 1:1: refresca el layout una vez tras montar para que el badge
  // del sidebar refleje el estado real. useRef evita el bucle.
  useEffect(() => {
    if (didRefreshLayoutRef.current) return;
    didRefreshLayoutRef.current = true;
    router.refresh();
  }, [router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || pending) return;

    const optimistic: TeamMessage = {
      id: `optimistic-${Date.now()}`,
      sender_profile_id: currentUserId,
      sender_name: '',
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const res = await sendTeamMessage(locale, {
        team_conversation_id: teamConversationId,
        body: trimmed,
      });
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, id: res.ok!.message_id } : m,
          ),
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(trimmed);
        const code = res.error ?? 'generic';
        setError(t(`errors.${code}`));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('thread.empty')}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_profile_id === currentUserId;
            return (
              <div
                key={m.id}
                className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
              >
                {!mine && m.sender_name && (
                  <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                    {m.sender_name}
                  </span>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    mine
                      ? 'bg-misterfc-green text-zinc-900'
                      : 'bg-zinc-800 text-zinc-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
                <span className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(m.created_at).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('thread.placeholder')}
          maxLength={2000}
          rows={2}
          className="flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
        />
        <Button type="submit" disabled={pending || draft.trim().length === 0}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          <span className="sr-only">{t('thread.send')}</span>
        </Button>
      </form>
    </div>
  );
}
