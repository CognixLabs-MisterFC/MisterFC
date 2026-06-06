'use client';

/**
 * F7.11 — Rivales destacados + notas del partido (solo de ESTE partido).
 *
 * Dos paneles independientes (layout 7.11 revisado): los RIVALES DESTACADOS van
 * ENCIMA de la línea de tiempo; las NOTAS del partido, debajo. Ambos comparten el
 * mismo modelo/acciones (sin cambios de lógica ni RLS): CRUD vía server actions +
 * refresh. Persisten e hidratan desde el padre → sobreviven a F5. Disponibles en
 * vivo y tras finalizar (cuerpo técnico / admin / coord).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { RivalHighlight } from '../queries';
import {
  deleteRivalHighlight,
  setMatchNotes,
  upsertRivalHighlight,
} from '../actions';

type MatchStatus = 'not_started' | 'live' | 'closed';

/** Hook común: ejecuta una server action y refresca al terminar. */
function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (
    fn: () => Promise<{ error?: string; success?: boolean }>,
    after?: () => void,
  ) => {
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
  return { run, pending, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rivales destacados (encima de la línea de tiempo).
// ─────────────────────────────────────────────────────────────────────────────

export function RivalHighlightsPanel({
  eventId,
  matchStatus,
  rivalHighlights,
  opponentName,
}: {
  eventId: string;
  matchStatus: MatchStatus;
  rivalHighlights: RivalHighlight[];
  opponentName: string | null;
}) {
  const t = useTranslations('partido_directo');
  const { run, pending, error } = useAction();

  const [formDorsal, setFormDorsal] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [editingDorsal, setEditingDorsal] = useState<number | null>(null);

  if (matchStatus === 'not_started') return null;

  const startEdit = (h: RivalHighlight) => {
    setEditingDorsal(h.dorsal);
    setFormDorsal(String(h.dorsal));
    setFormNote(h.note);
  };
  const resetForm = () => {
    setEditingDorsal(null);
    setFormDorsal('');
    setFormNote('');
  };

  const dorsalNum = Number(formDorsal);
  const canSubmit =
    Number.isInteger(dorsalNum) && dorsalNum >= 1 && dorsalNum <= 99 && formNote.trim().length > 0;

  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Star className="size-3.5" aria-hidden />
        {t('rivals.title')}
        {opponentName && <span className="normal-case text-muted-foreground/70">· {opponentName}</span>}
      </p>

      {error && (
        <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {t('rivals.error')}: {error}
        </p>
      )}

      {rivalHighlights.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">{t('rivals.empty')}</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {rivalHighlights.map((h) => (
            <li key={h.dorsal} className="flex items-center gap-2 text-sm">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs tabular-nums">
                {h.dorsal}
              </span>
              <span className="min-w-0 flex-1 truncate">{h.note}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => startEdit(h)}
                aria-label={t('rivals.edit')}
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                disabled={pending}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-600 disabled:opacity-50"
                onClick={() => run(() => deleteRivalHighlight({ event_id: eventId, dorsal: h.dorsal }))}
                aria-label={t('rivals.delete')}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-background/60 p-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('rivals.field_dorsal')}</span>
          <input
            type="number"
            min={1}
            max={99}
            value={formDorsal}
            disabled={editingDorsal != null}
            onChange={(e) => setFormDorsal(e.target.value)}
            className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('rivals.field_note')}</span>
          <input
            type="text"
            maxLength={200}
            value={formNote}
            placeholder={t('rivals.note_placeholder')}
            onChange={(e) => setFormNote(e.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={pending || !canSubmit}
          onClick={() =>
            run(
              () => upsertRivalHighlight({ event_id: eventId, dorsal: dorsalNum, note: formNote.trim() }),
              resetForm,
            )
          }
        >
          <Plus className="size-4" aria-hidden />
          {editingDorsal != null ? t('rivals.save') : t('rivals.add')}
        </Button>
        {editingDorsal != null && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={resetForm}>
            <X className="size-4" aria-hidden /> {t('rivals.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notas del partido (debajo de la línea de tiempo, donde estaban).
// ─────────────────────────────────────────────────────────────────────────────

export function MatchNotesPanel({
  eventId,
  matchStatus,
  matchNotes,
}: {
  eventId: string;
  matchStatus: MatchStatus;
  matchNotes: string;
}) {
  const t = useTranslations('partido_directo');
  const { run, pending, error } = useAction();
  const [notesDraft, setNotesDraft] = useState<string>(matchNotes);

  if (matchStatus === 'not_started') return null;

  const notesDirty = notesDraft.trim() !== matchNotes.trim();

  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      {error && (
        <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {t('rivals.error')}: {error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('rivals.notes_title')}
        <textarea
          rows={3}
          maxLength={4000}
          value={notesDraft}
          placeholder={t('rivals.notes_placeholder')}
          onChange={(e) => setNotesDraft(e.target.value)}
          className="resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal normal-case text-foreground"
        />
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !notesDirty}
          onClick={() => run(() => setMatchNotes({ event_id: eventId, notes: notesDraft }))}
        >
          {t('rivals.notes_save')}
        </Button>
        {notesDirty && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setNotesDraft(matchNotes)}>
            {t('rivals.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
