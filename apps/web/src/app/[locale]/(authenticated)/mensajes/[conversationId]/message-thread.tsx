'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendMessage } from '../actions';

type Message = {
  id: string;
  sender_profile_id: string;
  body: string;
  sent_at: string;
  read_at: string | null;
};

type Props = {
  locale: string;
  conversationId: string;
  currentUserId: string;
  initialMessages: Message[];
};

/**
 * Hilo de la conversación. Render server-rendered de mensajes iniciales +
 * optimistic UI al enviar. Sin realtime de Supabase (decisión spec 5.0
 * §11): el next-step de polling cada 15s queda fuera de Lote A para
 * mantenerlo simple. Lote B añade push y eso cubre el "real-time" práctico
 * desde la perspectiva del usuario.
 */
export function MessageThread({
  locale,
  conversationId,
  currentUserId,
  initialMessages,
}: Props) {
  const t = useTranslations('mensajes');
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || pending) return;

    // Optimistic — añade el mensaje provisional. Si el server falla, se
    // revierte y se enseña el error.
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      sender_profile_id: currentUserId,
      body: trimmed,
      sent_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const res = await sendMessage(locale, {
        conversation_id: conversationId,
        body: trimmed,
      });
      if (res.ok) {
        // Sustituye el id optimista por el real.
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
                  {new Date(m.sent_at).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {mine && m.read_at && ` · ${t('thread.read')}`}
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
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('thread.placeholder')}
          maxLength={2000}
          rows={2}
          className="flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm focus:border-misterfc-green focus:outline-none"
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
