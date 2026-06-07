'use client';

/**
 * F7 (mejora) — Notas por jugador en la ficha (lista con fecha + autor, y
 * añadir/editar/borrar). Solo se renderiza para el cuerpo técnico (el servidor ya
 * lo decidió vía user_can_access_player_notes); la RLS es la autoridad final.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import {
  createPlayerNote,
  deletePlayerNote,
  updatePlayerNote,
} from '../player-notes-actions';

export type PlayerNoteItem = {
  id: string;
  note: string;
  createdAt: string;
  authorName: string | null;
};

export function PlayerNotesSection({
  playerId,
  notes,
  locale,
}: {
  playerId: string;
  notes: PlayerNoteItem[];
  locale: string;
}) {
  const t = useTranslations('jugadores.notes');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

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
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {t('error')}: {error}
        </p>
      )}

      {/* Alta */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card/30 p-2">
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
            disabled={pending || draft.trim().length === 0}
            onClick={() =>
              run(() => createPlayerNote({ player_id: playerId, note: draft.trim() }), () =>
                setDraft(''),
              )
            }
          >
            <Plus className="size-4" aria-hidden /> {t('add')}
          </Button>
        </div>
      </div>

      {/* Lista */}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 py-2">
              {editingId === n.id ? (
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
                        run(() => updatePlayerNote({ id: n.id, note: editText.trim() }), () =>
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
                  <p className="whitespace-pre-wrap text-sm">{n.note}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(n.createdAt)}
                      {n.authorName ? ` · ${n.authorName}` : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditText(n.note);
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
                            run(() => deletePlayerNote({ id: n.id }));
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
