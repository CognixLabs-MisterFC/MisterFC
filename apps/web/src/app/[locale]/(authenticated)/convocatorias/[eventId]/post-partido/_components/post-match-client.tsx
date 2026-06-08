'use client';

/**
 * F8.2 — Formulario de valoración post-partido.
 *
 * Etapa terminal del ciclo (spec 8.0 §3). Por cada jugador de la plantilla que
 * participó: nota 1-10, comentario y MVP (único por evento, exclusivo en UI). Las
 * stats de 7.10 se muestran como CONTEXTO en solo lectura (§6), sin mezclarse con
 * la valoración. Las notas privadas (8.4) NO van aquí.
 *
 * Persistencia upsert por jugador (no recargamos la página al guardar para no
 * perder los borradores de las otras filas). "Completar valoraciones" cierra la
 * etapa (post_match_done) con confirmación de dos pasos; no exige valorar a todos
 * (D6). En partido la nota es obligatoria a nivel de fila: no se puede guardar
 * una fila sin número (lo valida el cliente; el trigger es la red).
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Check,
  Loader2,
  Radio,
  Star,
  Users,
} from 'lucide-react';
import { RATING_MIN, RATING_MAX, formatPlayerName } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { PostMatchPlayer, PostMatchStats } from '../queries';
import {
  upsertEvaluation,
  deleteEvaluation,
  setPostMatchDone,
  upsertTeamEvaluation,
  deleteTeamEvaluation,
} from '../actions';

type MatchStatus = 'not_started' | 'live' | 'closed';
type TeamEvaluation = { rating: number; comment: string | null } | null;

type Draft = { rating: number | null; comment: string; isMvp: boolean };

function draftOf(p: PostMatchPlayer): Draft {
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

const EMPTY_DRAFT: Draft = { rating: null, comment: '', isMvp: false };

const RATINGS = Array.from(
  { length: RATING_MAX - RATING_MIN + 1 },
  (_, i) => RATING_MIN + i,
);

export function PostMatchClient({
  eventId,
  matchStatus,
  postMatchDone,
  score,
  players,
  teamEvaluation,
}: {
  eventId: string;
  matchStatus: MatchStatus;
  postMatchDone: boolean;
  score: { own: number | null; against: number | null };
  players: PostMatchPlayer[];
  teamEvaluation: TeamEvaluation;
}) {
  const t = useTranslations('post_partido');

  // El formulario solo se abre con el partido FINALIZADO ('closed'). Si se reabrió
  // ('live') o no se ha jugado, se informa (las valoraciones se conservan).
  if (matchStatus !== 'closed') {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="mb-1 inline-flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          {matchStatus === 'live' ? t('reopened_title') : t('not_finished_title')}
        </p>
        <p className="text-muted-foreground">
          {matchStatus === 'live' ? t('reopened_hint') : t('not_finished_hint')}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/convocatorias/${eventId}/directo`}>
            <Radio className="size-4" aria-hidden />
            <span>{t('go_live')}</span>
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <PostMatchForm
      eventId={eventId}
      postMatchDone={postMatchDone}
      score={score}
      players={players}
      teamEvaluation={teamEvaluation}
      t={t}
    />
  );
}

function PostMatchForm({
  eventId,
  postMatchDone,
  score,
  players,
  teamEvaluation,
  t,
}: {
  eventId: string;
  postMatchDone: boolean;
  score: { own: number | null; against: number | null };
  players: PostMatchPlayer[];
  teamEvaluation: TeamEvaluation;
  t: ReturnType<typeof useTranslations>;
}) {
  // Estado editable por jugador + baseline (lo guardado) para detectar cambios.
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(players.map((p) => [p.playerId, draftOf(p)])),
  );
  const [baseline, setBaseline] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(players.map((p) => [p.playerId, draftOf(p)])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const [done, setDone] = useState(postMatchDone);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

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

  const valued = useMemo(
    () => players.filter((p) => baseline[p.playerId]?.rating != null).length,
    [players, baseline],
  );

  async function save(p: PostMatchPlayer) {
    const d = drafts[p.playerId] ?? EMPTY_DRAFT;
    // En partido la nota es obligatoria a nivel de fila.
    if (d.rating == null) {
      setErrorById((e) => ({ ...e, [p.playerId]: 'rating_required' }));
      return;
    }
    setSavingId(p.playerId);
    setErrorById((e) => ({ ...e, [p.playerId]: '' }));
    const res = await upsertEvaluation({
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
    // Baseline = lo guardado. Si este pasó a MVP, el resto quedó sin MVP en BD.
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

  async function removeEval(p: PostMatchPlayer) {
    setSavingId(p.playerId);
    setErrorById((e) => ({ ...e, [p.playerId]: '' }));
    const res = await deleteEvaluation({ event_id: eventId, player_id: p.playerId });
    setSavingId(null);
    if (res.error) {
      setErrorById((e) => ({ ...e, [p.playerId]: res.error as string }));
      return;
    }
    const empty: Draft = { rating: null, comment: '', isMvp: false };
    setDrafts((prev) => ({ ...prev, [p.playerId]: empty }));
    setBaseline((prev) => ({ ...prev, [p.playerId]: empty }));
  }

  async function complete(next: boolean) {
    setCompleting(true);
    setCompleteError(null);
    const res = await setPostMatchDone({ event_id: eventId, done: next });
    setCompleting(false);
    setConfirmComplete(false);
    if (res.error) {
      setCompleteError(res.error);
      return;
    }
    setDone(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Marcador final (contexto). */}
      {score.own != null && score.against != null && (
        <p className="text-sm text-muted-foreground">
          {t('final_score')}:{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {score.own} – {score.against}
          </span>
        </p>
      )}

      {/* F8.3 — valoración COLECTIVA del equipo, encima del listado individual e
          independiente de él. */}
      <TeamEvaluationSection
        eventId={eventId}
        initial={teamEvaluation}
        t={t}
      />

      {players.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/30 p-4 text-sm text-muted-foreground">
          {t('no_players')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {players.map((p) => {
            const d = drafts[p.playerId] ?? EMPTY_DRAFT;
            const dirty = !sameDraft(d, baseline[p.playerId] ?? EMPTY_DRAFT);
            const err = errorById[p.playerId];
            const saving = savingId === p.playerId;
            const justSaved = savedId === p.playerId;
            const hasEval = baseline[p.playerId]?.rating != null;
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
                    {p.stats?.started && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {t('starter')}
                      </span>
                    )}
                  </div>
                  {/* MVP toggle */}
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

                {/* Contexto: stats materializadas (solo lectura, §6). */}
                <StatsStrip stats={p.stats} t={t} />

                {/* Nota 1-10 */}
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
                        onClick={() =>
                          set(p.playerId, { rating: sel ? null : n })
                        }
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

                {/* Comentario */}
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
                    disabled={saving || !dirty || d.rating == null}
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
      )}

      {/* Cierre de la etapa. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/30 p-3">
        {completeError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {t(`error.${completeError}`)}
          </p>
        )}
        {done ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="size-4" aria-hidden />
              {t('completed')}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={completing}
              onClick={() => complete(false)}
            >
              {t('reopen_stage')}
            </Button>
          </div>
        ) : confirmComplete ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('complete_confirm')}</span>
            <Button type="button" size="sm" disabled={completing} onClick={() => complete(true)}>
              {completing && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('complete_yes')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={completing}
              onClick={() => setConfirmComplete(false)}
            >
              {t('complete_cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t('valued_count', { valued, total: players.length })}
            </span>
            <Button type="button" size="sm" onClick={() => setConfirmComplete(true)}>
              {t('complete')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * F8.3 — Valoración COLECTIVA del equipo (una por partido). Independiente del
 * listado individual: nota 1-10 (obligatoria) + comentario. Guardado directo,
 * sin recargar.
 */
function TeamEvaluationSection({
  eventId,
  initial,
  t,
}: {
  eventId: string;
  initial: { rating: number; comment: string | null } | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [comment, setComment] = useState<string>(initial?.comment ?? '');
  const [base, setBase] = useState<{ rating: number | null; comment: string }>({
    rating: initial?.rating ?? null,
    comment: initial?.comment ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEval = base.rating != null;
  const dirty =
    rating !== base.rating || comment.trim() !== base.comment.trim();

  async function save() {
    if (rating == null) {
      setError('team_rating_required');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await upsertTeamEvaluation({
      event_id: eventId,
      rating,
      comment: comment.trim() === '' ? null : comment.trim(),
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setBase({ rating, comment: comment.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function remove() {
    setSaving(true);
    setError(null);
    const res = await deleteTeamEvaluation({ event_id: eventId });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRating(null);
    setComment('');
    setBase({ rating: null, comment: '' });
  }

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
        <Users className="size-4" aria-hidden />
        {t('team_title')}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">{t('rating')}</span>
        {RATINGS.map((n) => {
          const sel = rating === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(sel ? null : n)}
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
        value={comment}
        placeholder={t('team_comment_placeholder')}
        onChange={(e) => setComment(e.target.value)}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {t(`error.${error}`)}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || !dirty || rating == null}
          onClick={save}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : saved ? (
            <Check className="size-4" aria-hidden />
          ) : null}
          {saved ? t('saved') : t('save')}
        </Button>
        {hasEval && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={remove}
          >
            {t('clear')}
          </Button>
        )}
        {dirty && !saving && (
          <span className="text-xs text-muted-foreground">{t('unsaved')}</span>
        )}
      </div>
    </div>
  );
}

/** Tira de stats materializadas (7.10) en solo lectura: contexto al valorar. */
function StatsStrip({
  stats,
  t,
}: {
  stats: PostMatchStats | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!stats) {
    return (
      <p className="mb-2 text-xs italic text-muted-foreground">
        {t('did_not_play')}
      </p>
    );
  }
  const chips: Array<{ label: string; value: number; title: string }> = [
    { label: `${stats.minutesPlayed}′`, value: stats.minutesPlayed, title: t('stat.minutes') },
    { label: `${stats.goals} G`, value: stats.goals, title: t('stat.goals') },
    { label: `${stats.assists} A`, value: stats.assists, title: t('stat.assists') },
    { label: `${stats.shots} T`, value: stats.shots, title: t('stat.shots') },
    { label: `${stats.yellowCards} 🟨`, value: stats.yellowCards, title: t('stat.yellow') },
    { label: `${stats.redCards} 🟥`, value: stats.redCards, title: t('stat.red') },
    { label: `${stats.foulsCommitted} FC`, value: stats.foulsCommitted, title: t('stat.fouls_committed') },
    { label: `${stats.foulsReceived} FR`, value: stats.foulsReceived, title: t('stat.fouls_received') },
    { label: `${stats.penaltiesScored}/${stats.penaltiesScored + stats.penaltiesMissed} P`, value: stats.penaltiesScored + stats.penaltiesMissed, title: t('stat.penalties') },
  ];
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {chips
        .filter((c) => c.value > 0 || c.title === t('stat.minutes'))
        .map((c) => (
          <span
            key={c.title}
            title={c.title}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {c.label}
          </span>
        ))}
    </div>
  );
}
