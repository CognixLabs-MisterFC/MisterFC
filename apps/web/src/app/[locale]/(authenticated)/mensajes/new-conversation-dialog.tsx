'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquarePlus, Search } from 'lucide-react';
import { formatPlayerName } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  listMessageablePlayers,
  startConversation,
  type MessageablePlayer,
} from './actions';

type Props = { locale: string };

/**
 * F5B-1 — "Nueva conversación". Abre un selector de jugadores del club con
 * buscador y arranca (o reabre) el chat 1:1 con el elegido vía
 * `startConversation` (idempotente por UNIQUE(coach, player)). No duplica la
 * lógica de creación ni toca el modelo/RLS: solo lista (lectura) y navega.
 *
 * Los jugadores se cargan UNA vez al abrir (RLS-scoped) y el término filtra en
 * cliente — sin debounce ni round-trips por tecla (clubs de beta pequeños).
 */
export function NewConversationDialog({ locale }: Props) {
  const t = useTranslations('mensajes.new_conversation');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<MessageablePlayer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [term, setTerm] = useState('');
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Reset + carga perezosa al abrir.
      setTerm('');
      setSelectingId(null);
      if (players === null && !loading) {
        setLoading(true);
        setLoadError(false);
        void listMessageablePlayers().then((res) => {
          setLoading(false);
          if (res.players) setPlayers(res.players);
          else setLoadError(true);
        });
      }
    }
  }

  const filtered = useMemo(() => {
    const list = players ?? [];
    const q = term.trim().toLowerCase();
    if (q.length === 0) return list;
    return list.filter((p) =>
      formatPlayerName(p.first_name, p.last_name).toLowerCase().includes(q),
    );
  }, [players, term]);

  function onSelect(playerId: string) {
    if (pending) return;
    setSelectingId(playerId);
    startTransition(async () => {
      const res = await startConversation(locale, { player_id: playerId });
      if (res.ok) {
        setOpen(false);
        router.push(`/${locale}/mensajes/${res.ok.conversation_id}`);
      } else {
        setSelectingId(null);
        setLoadError(true);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <MessageSquarePlus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('search_placeholder')}
              className="pl-9"
              autoFocus
              aria-label={t('search_placeholder')}
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {loading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t('loading')}
              </p>
            ) : loadError ? (
              <p role="alert" className="py-6 text-sm text-destructive">
                {t('error')}
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {filtered.map((p) => {
                  const name = formatPlayerName(p.first_name, p.last_name);
                  const isSelecting = selectingId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        disabled={pending}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-muted/30 disabled:opacity-60"
                      >
                        <span className="font-medium">{name}</span>
                        {isSelecting && (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
