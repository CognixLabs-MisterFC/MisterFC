'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Search, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { listMessageableTeams, type MessageableTeam } from './actions';

type Props = { locale: string };

/**
 * F5B-3 (P2b) — "Chat de equipo". Selector de equipos del club con buscador;
 * al elegir uno navega a su hilo de grupo (idempotente: la página crea el hilo
 * si procede o lo abre). Mismo patrón que NewConversationDialog (1:1).
 */
export function NewTeamChatDialog({ locale }: Props) {
  const t = useTranslations('mensajes.new_team_chat');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<MessageableTeam[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [term, setTerm] = useState('');

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTerm('');
      if (teams === null && !loading) {
        setLoading(true);
        setLoadError(false);
        void listMessageableTeams().then((res) => {
          setLoading(false);
          if (res.teams) setTeams(res.teams);
          else setLoadError(true);
        });
      }
    }
  }

  const filtered = useMemo(() => {
    const list = teams ?? [];
    const q = term.trim().toLowerCase();
    if (q.length === 0) return list;
    return list.filter((tm) => tm.name.toLowerCase().includes(q));
  }, [teams, term]);

  function onSelect(teamId: string) {
    setOpen(false);
    router.push(`/${locale}/mensajes/equipo/${teamId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <UsersRound className="size-4" aria-hidden />
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
                {filtered.map((tm) => (
                  <li key={tm.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(tm.id)}
                      className="flex w-full items-center gap-2 py-3 text-left text-sm hover:bg-muted/30"
                    >
                      <UsersRound
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="font-medium">{tm.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
