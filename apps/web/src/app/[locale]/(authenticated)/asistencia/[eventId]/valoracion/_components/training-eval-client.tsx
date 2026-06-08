'use client';

/**
 * F8.3 — Formulario de valoración de ENTRENAMIENTO (flujo ligero, spec 8.0 §3.6).
 *
 * Por cada jugador que asistió (∪ ya valorados): nota 1-10 OPCIONAL, comentario
 * y MVP (único por evento, exclusivo en UI). La asistencia se muestra como
 * CONTEXTO en solo lectura. Sin "Completar valoraciones" (eso es de partidos con
 * match_state). Guardado por fila, sin recargar (no se pierden borradores de
 * otras filas). Las notas privadas (8.4) NO van aquí.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Star } from 'lucide-react';
import { RATING_MIN, RATING_MAX, formatPlayerName } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import type { TrainingEvalPlayer } from '../queries';
import {
  upsertTrainingEvaluation,
  deleteTrainingEvaluation,
} from '../actions';

type Draft = { rating: number | null; comment: string; isMvp: boolean };

const EMPTY_DRAFT: Draft = { rating: null, comment: '', isMvp: false };

function draftOf(p: TrainingEvalPlayer): Draft {
  return {
    rating: p.evaluation?.rating ?? null,
    comment: p.evaluation?.comment ?? '',
    isMvp: p.evaluation?.isMvp ?? false,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.rating === b.rating &&
    a.comment.trim() === b.comment.trim() &&
    a.isMvp === b.isMvp
  );
}

function notEmpty(d: Draft): boolean {
  return d.rating != null || d.comment.trim() !== '' || d.isMvp;
}

const RATINGS = Array.from(
  { length: RATING_MAX - RATING_MIN + 1 },
  (_, i) => RATING_MIN + i,
);

export function TrainingEvalClient({
  eventId,
  players,
}: {
  eventId: string;
  players: TrainingEvalPlayer[];
}) {
  const t = useTranslations('valoracion_entreno');
  const tCodes = useTranslations('asistencia.codes');

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(players.map((p) => [p.playerId, draftOf(p)])),
  );
  const [baseline, setBaseline] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(players.map((p) => [p.playerId, draftOf(p)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const set = (playerId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? EMPTY_DRAFT), ...patch },
    }));

  // MVP exclusivo en UI: marcar uno desmarca al resto.
  const setMvp = (playerId: string) =>
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      for (const [pid, d] of Object.entries(prev)) {
        next[pid] = { ...d, isMvp: pid === playerId ? !d.isMvp : false };
      }
      return next;
    });

  async function save(p: TrainingEvalPlayer) {
    const d = drafts[p.playerId] ?? EMPTY_DRAFT;
    if (!notEmpty(d)) {
      setErrorById((e) => ({ ...e, [p.playerId]: 'empty' }));
      return;
    }
    setSavingId(p.playerId);
    setErrorById((e) => ({ ...e, [p.playerId]: '' }));
    const res = await upsertTrainingEvaluation({
      event_id: eventId,
      player_id: p.playerId,
      rating: d.rating,
      comment: d.comment.trim() === '' ? null : d.comment.trim(),
      is_mvp: d.isMvp,
    });
    setSavingId(null);
    if (res.error) {
      setErrorById((e) => ({ ...e, [p.playerId]: res.error as string }));
      return;
    }
    setBaseline((prev) => {
      const next = { ...prev, [p.playerId]: { ...d, comment: d.comment.trim() } };
      if (d.isMvp) {
        for (const [pid, b] of Object.entries(next)) {
          if (pid !== p.playerId && b.isMvp) next[pid] = { ...b, isMvp: false };
        }
      }
      return next;
    });
    setSavedId(p.playerId);
    setTimeout(() => setSavedId((s) => (s === p.playerId ? null : s)), 1800);
  }

  async function removeEval(p: TrainingEvalPlayer) {
    setSavingId(p.playerId);
    setErrorById((e) => ({ ...e, [p.playerId]: '' }));
    const res = await deleteTrainingEvaluation({
      event_id: eventId,
      player_id: p.playerId,
    });
    setSavingId(null);
    if (res.error) {
      setErrorById((e) => ({ ...e, [p.playerId]: res.error as string }));
      return;
    }
    setDrafts((prev) => ({ ...prev, [p.playerId]: { ...EMPTY_DRAFT } }));
    setBaseline((prev) => ({ ...prev, [p.playerId]: { ...EMPTY_DRAFT } }));
  }

  if (players.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card/30 p-4 text-sm text-muted-foreground">
        {t('no_players')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {players.map((p) => {
        const d = drafts[p.playerId] ?? EMPTY_DRAFT;
        const dirty = !sameDraft(d, baseline[p.playerId] ?? EMPTY_DRAFT);
        const err = errorById[p.playerId];
        const saving = savingId === p.playerId;
        const justSaved = savedId === p.playerId;
        const hasEval =
          (baseline[p.playerId] ?? EMPTY_DRAFT) &&
          !sameDraft(baseline[p.playerId] ?? EMPTY_DRAFT, EMPTY_DRAFT);
        return (
          <li
            key={p.playerId}
            className="rounded-lg border border-border bg-card/30 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {p.dorsal != null && (
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs tabular-nums">
                    {p.dorsal}
                  </span>
                )}
                <span className="truncate font-medium">
                  {formatPlayerName(p.firstName, p.lastName)}
                </span>
                {/* Contexto: asistencia a este entreno (solo lectura). */}
                {p.attendanceCode && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {tCodes(p.attendanceCode)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMvp(p.playerId)}
                aria-pressed={d.isMvp}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  d.isMvp
                    ? 'border-amber-400 bg-amber-400/15 text-amber-700 dark:text-amber-300'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Star
                  className={`size-3.5 ${d.isMvp ? 'fill-amber-400' : ''}`}
                  aria-hidden
                />
                {t('mvp')}
              </button>
            </div>

            {/* Nota 1-10 (OPCIONAL en entreno) */}
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">
                {t('rating')}
              </span>
              {RATINGS.map((n) => {
                const sel = d.rating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set(p.playerId, { rating: sel ? null : n })}
                    aria-pressed={sel}
                    className={`size-8 rounded-md border text-sm font-medium tabular-nums transition-colors ${
                      sel
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <textarea
              rows={2}
              maxLength={2000}
              value={d.comment}
              placeholder={t('comment_placeholder')}
              onChange={(e) => set(p.playerId, { comment: e.target.value })}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />

            {err && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {t(`error.${err}`)}
              </p>
            )}

            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saving || !dirty || !notEmpty(d)}
                onClick={() => save(p)}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : justSaved ? (
                  <Check className="size-4" aria-hidden />
                ) : null}
                {justSaved ? t('saved') : t('save')}
              </Button>
              {hasEval && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => removeEval(p)}
                >
                  {t('clear')}
                </Button>
              )}
              {dirty && !saving && (
                <span className="text-xs text-muted-foreground">
                  {t('unsaved')}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
