'use client';

import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  useVisibleInterval,
  mergePolledMessages,
  isNearBottom,
  CHAT_POLL_INTERVAL_MS,
} from '@/hooks/use-chat-polling';
import {
  sendStaffMessage,
  fetchStaffMessages,
  type StaffThreadMessage,
} from '../../actions';

type Props = {
  locale: string;
  conversationId: string;
  currentUserId: string;
  initialMessages: StaffThreadMessage[];
};

/**
 * O2-12 — Hilo del chat privado entre STAFF. Mismo patrón que el 1:1/equipo: render
 * server + optimistic UI + polling ~5s + router.refresh() al montar (badge del
 * sidebar). Append-only: solo leer y enviar. Usa `created_at` (sin read_at).
 */
export function StaffMessageThread({
  locale,
  conversationId,
  currentUserId,
  initialMessages,
}: Props) {
  const t = useTranslations('mensajes');
  const router = useRouter();
  const [messages, setMessages] = useState<StaffThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const didRefreshLayoutRef = useRef(false);

  useEffect(() => {
    if (stickRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  useEffect(() => {
    if (didRefreshLayoutRef.current) return;
    didRefreshLayoutRef.current = true;
    router.refresh();
  }, [router]);

  const poll = useCallback(async () => {
    const fresh = await fetchStaffMessages(conversationId);
    stickRef.current = isNearBottom(scrollRef.current);
    setMessages((prev) => mergePolledMessages(fresh, prev));
  }, [conversationId]);
  useVisibleInterval(poll, CHAT_POLL_INTERVAL_MS);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || pending) return;

    const optimistic: StaffThreadMessage = {
      id: `optimistic-${Date.now()}`,
      sender_profile_id: currentUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    stickRef.current = true;
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const res = await sendStaffMessage(locale, {
        conversation_id: conversationId,
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
      <div
        ref={scrollRef}
        className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto"
      >
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
