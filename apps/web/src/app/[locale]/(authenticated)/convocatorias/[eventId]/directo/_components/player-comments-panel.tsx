'use client';

/**
 * F7.13 (mejora #11) — APARTADO DEDICADO de comentarios de jugadores en el directo.
 *
 * Panel visible y permanente, SOLO staff (la página /directo ya está gateada por
 * rol + user_can_record_match; la RLS de player_notes — user_can_access_player_notes
 * — es la autoridad). NO está atado al estado del partido: se ven/añaden/editan/
 * borran con el partido sin empezar, en juego o cerrado (las notas no son eventos de
 * reloj). Reutiliza las server actions de player_notes (no duplica modelo) y muestra
 * las notas ORIGINADAS en este partido (match_event_id = este evento).
 */

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import type { PlayerComment, RosterPlayer } from '../queries';
import {
  createPlayerNote,
  deletePlayerNote,
  updatePlayerNote,
} from '../../../../jugadores/player-notes-actions';

export function PlayerCommentsPanel({
  eventId,
  locale,
  comments,
  rosterPlayers,
}: {
  eventId: string;
  locale: string;
  comments: PlayerComment[];
  rosterPlayers: RosterPlayer[];
}) {
  const t = useTranslations('partido_directo.player_comments');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftPlayer, setDraftPlayer] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const playerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of rosterPlayers) {
      m.set(p.playerId, p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label);
    }
    return m;
  }, [rosterPlayers]);

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setPending(true);
    setError(null);
    void fn()
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          after?.();
          startTransition(() => router.refresh());
        }
      })
      .finally(() => setPending(false));
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso));

  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="size-3.5" aria-hidden />
        {t('title')}{' '}
        <span className="text-muted-foreground/70">
          {t('count', { n: comments.length })}
        </span>
      </p>

      {error && (
        <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {t('error')}: {error}
        </p>
      )}

      {/* Alta: elegir jugador + comentario. Disponible en cualquier estado. */}
      <div className="mb-3 flex flex-col gap-2 rounded-md border border-border bg-background/60 p-2">
        <Select value={draftPlayer} onValueChange={setDraftPlayer}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder={t('select_player')} />
          </SelectTrigger>
          <SelectContent>
            {rosterPlayers.map((p) => (
              <SelectItem key={p.playerId} value={p.playerId}>
                {p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <textarea
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder={t('placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
        <div>
          <Button
            type="button"
            size="sm"
            disabled={pending || !draftPlayer || draft.trim().length === 0}
            onClick={() =>
              run(
                () =>
                  createPlayerNote({
                    player_id: draftPlayer,
                    note: draft.trim(),
                    match_event_id: eventId,
                  }),
                () => {
                  setDraft('');
                  setDraftPlayer('');
                },
              )
            }
          >
            <Plus className="size-4" aria-hidden /> {t('add')}
          </Button>
        </div>
      </div>

      {/* Lista de comentarios de este partido. */}
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 py-2">
              <span className="text-xs font-medium text-foreground">
                {playerLabel.get(c.playerId) ??
                  (c.dorsal != null ? `${c.dorsal} · ${c.playerLabel}` : c.playerLabel)}
              </span>
              {editingId === c.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || editText.trim().length === 0}
                      onClick={() =>
                        run(() => updatePlayerNote({ id: c.id, note: editText.trim() }), () =>
                          setEditingId(null),
                        )
                      }
                    >
                      {t('save')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-4" aria-hidden /> {t('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm">{c.note}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(c.createdAt)}
                      {c.authorName ? ` · ${c.authorName}` : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditText(c.note);
                          setError(null);
                        }}
                        aria-label={t('edit')}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="rounded p-1 text-muted-foreground hover:text-red-600 disabled:opacity-50"
                        onClick={() => {
                          if (window.confirm(t('confirm_delete'))) {
                            run(() => deletePlayerNote({ id: c.id }));
                          }
                        }}
                        aria-label={t('delete')}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
