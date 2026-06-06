'use client';

/**
 * F7.9 — Línea de tiempo EDITABLE.
 *
 * Lista cronológica de TODOS los eventos del partido (propios y rival). Cuatro
 * operaciones — borrar, cambiar el minuto, cambiar el jugador/dorsal y añadir un
 * evento olvidado — que mutan `match_events` vía server actions. NO hay estado
 * paralelo: tras cada edición se refresca y minutos (7.8), marcador/penaltis
 * (7.7c), contadores (7.4b) y expulsiones (7.3) se REDERIVAN de los eventos (todo
 * sobrevive a F5). La validación de estados imposibles (motor puro
 * `findTimelineIssues`) AVISA sin bloquear (spec 7.9).
 *
 * Accesible en vivo y tras finalizar (status 'live' o 'closed').
 */

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  clockSecondsAt,
  currentPeriod,
  displayMinute,
  findTimelineIssues,
  CORNER_SIDES,
  FOUL_KINDS,
  PENALTY_OUTCOMES,
  TIMELINE_ADD_TYPES,
  type ClockPeriod,
  type TimelineIssue,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { TimelineEntry, RosterPlayer } from '../queries';
import {
  addMatchEvent,
  deleteMatchEvent,
  updateMatchEventActor,
  updateMatchEventMinute,
} from '../actions';

type Props = {
  eventId: string;
  matchStatus: 'not_started' | 'live' | 'closed';
  timeline: TimelineEntry[];
  rosterPlayers: RosterPlayer[];
  periods: ClockPeriod[];
  absentIds: string[];
};

/** Tipos que NO se dan de alta aquí (tienen su propia UI/derivación). */
const NON_ADDABLE = new Set(['substitution', 'formation_change', 'shootout_penalty']);

function minuteOf(e: TimelineEntry): number {
  return e.displayMinute ?? Math.floor(e.clockSeconds / 60);
}

export function TimelineEditor({
  eventId,
  matchStatus,
  timeline,
  rosterPlayers,
  periods,
  absentIds,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Estados imposibles (avisar, no romper): se calculan sobre la línea actual.
  const issues = useMemo<TimelineIssue[]>(
    () =>
      findTimelineIssues(
        timeline.map((e) => ({
          id: e.id,
          side: e.side,
          type: e.type,
          playerId: e.playerId,
          relatedPlayerId: e.relatedPlayerId,
          clockSeconds: e.clockSeconds,
        })),
        { absentIds },
      ),
    [timeline, absentIds],
  );
  const issuesByEvent = useMemo(() => {
    const m = new Map<string, TimelineIssue[]>();
    for (const i of issues) {
      const arr = m.get(i.eventId) ?? [];
      arr.push(i);
      m.set(i.eventId, arr);
    }
    return m;
  }, [issues]);

  // Minuto sugerido para el alta: el reloj actual plegado (sin tictac).
  const defaultMinute = useMemo(() => {
    const cur = currentPeriod(periods);
    const nowMs = cur?.running && cur.lastStartedAt ? Date.parse(cur.lastStartedAt) : 0;
    return displayMinute(clockSecondsAt(periods, nowMs));
  }, [periods]);

  const rosterLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of rosterPlayers) {
      m.set(p.playerId, p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label);
    }
    return m;
  }, [rosterPlayers]);

  if (matchStatus === 'not_started') return null;

  const run = (fn: () => Promise<{ error?: string; success?: boolean }>) => {
    setPending(true);
    setError(null);
    void fn()
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setEditingId(null);
          setAdding(false);
          startTransition(() => router.refresh());
        }
      })
      .finally(() => setPending(false));
  };

  function describe(e: TimelineEntry): string {
    switch (e.type) {
      case 'substitution':
        return t('timeline.sub_arrow', {
          out: e.playerLabel ?? '—',
          in: e.relatedPlayerLabel ?? '—',
        });
      case 'formation_change':
        return t('formation_change_event', {
          from: e.formationFrom ?? '—',
          to: e.formationTo ?? '—',
        });
      case 'foul':
        return `${t('event.foul')} · ${t(e.foulKind === 'received' ? 'foul_received' : 'foul_committed')}`;
      case 'corner':
        return `${t('event.corner')} · ${t(e.cornerSide === 'against' ? 'event.corner_against' : 'event.corner_for')}`;
      case 'penalty':
        return `${t('event.penalty')}${e.outcome ? ` · ${t(`penalty_outcome.${e.outcome}`)}` : ''}`;
      case 'shootout_penalty':
        return `${t('timeline.shootout')}${e.outcome ? ` · ${t(`shootout_outcome.${e.outcome}`)}` : ''}`;
      default:
        return t(`event.${e.type}`);
    }
  }

  function actorText(e: TimelineEntry): string | null {
    if (e.side === 'rival') return e.rivalDorsal != null ? `#${e.rivalDorsal}` : null;
    if (e.playerId) return rosterLabel.get(e.playerId) ?? e.playerLabel ?? null;
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('timeline.title')}{' '}
          <span className="text-muted-foreground/70">
            {t('timeline.count', { n: timeline.length })}
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          variant={adding ? 'secondary' : 'outline'}
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
            setError(null);
          }}
        >
          {adding ? (
            <>
              <X className="size-4" aria-hidden /> {t('timeline.add_cancel')}
            </>
          ) : (
            <>
              <Plus className="size-4" aria-hidden /> {t('timeline.add')}
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
          {t('timeline.error')}: {error}
        </p>
      )}

      {issues.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
          <span className="inline-flex items-center gap-1 font-medium">
            <AlertTriangle className="size-3" aria-hidden />
            {t('timeline.issues_title', { n: issues.length })}
          </span>
        </div>
      )}

      {adding && (
        <AddEventForm
          eventId={eventId}
          rosterPlayers={rosterPlayers}
          defaultMinute={defaultMinute}
          pending={pending}
          onSubmit={(input) => run(() => addMatchEvent(input))}
        />
      )}

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timeline.empty')}</p>
      ) : (
        <ol className="flex flex-col">
          {timeline.map((e) => {
            const evIssues = issuesByEvent.get(e.id) ?? [];
            const isEditing = editingId === e.id;
            const actor = actorText(e);
            return (
              <li
                key={e.id}
                className={cn(
                  'border-b border-border/40 py-1.5 last:border-0',
                  e.side === 'rival' && 'opacity-90',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {t('clock_minute', { minute: minuteOf(e) })}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 text-[10px] uppercase',
                      e.side === 'own'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {t(e.side === 'own' ? 'timeline.side_own' : 'timeline.side_rival')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {describe(e)}
                    {actor && (
                      <span className="ml-1 text-muted-foreground">· {actor}</span>
                    )}
                  </span>
                  {evIssues.length > 0 && (
                    <span
                      className="shrink-0 text-amber-600 dark:text-amber-400"
                      title={evIssues.map((i) => t(`timeline.issue.${i.code}`)).join(' · ')}
                    >
                      <AlertTriangle className="size-3.5" aria-hidden />
                    </span>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditingId(isEditing ? null : e.id);
                      setAdding(false);
                      setError(null);
                    }}
                    aria-label={t('timeline.edit')}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-600 disabled:opacity-50"
                    onClick={() => {
                      if (window.confirm(t('timeline.confirm_delete'))) {
                        run(() => deleteMatchEvent({ event_id: eventId, id: e.id }));
                      }
                    }}
                    aria-label={t('timeline.delete')}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>

                {isEditing && (
                  <EditRow
                    entry={e}
                    eventId={eventId}
                    rosterPlayers={rosterPlayers}
                    pending={pending}
                    onMinute={(minute) =>
                      run(() =>
                        updateMatchEventMinute({
                          event_id: eventId,
                          id: e.id,
                          display_minute: minute,
                        }),
                      )
                    }
                    onActor={(patch) =>
                      run(() => updateMatchEventActor({ event_id: eventId, id: e.id, ...patch }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
        {t('timeline.hint')}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edición inline de una fila: minuto + actor (jugador / dorsal / sustitución).
// ─────────────────────────────────────────────────────────────────────────────

function EditRow({
  entry,
  rosterPlayers,
  pending,
  onMinute,
  onActor,
}: {
  entry: TimelineEntry;
  eventId: string;
  rosterPlayers: RosterPlayer[];
  pending: boolean;
  onMinute: (minute: number) => void;
  onActor: (patch: {
    player_id?: string;
    related_player_id?: string;
    rival_dorsal?: number;
  }) => void;
}) {
  const t = useTranslations('partido_directo');
  const [minute, setMinute] = useState<number>(minuteOf(entry));
  const [playerId, setPlayerId] = useState<string>(entry.playerId ?? '');
  const [relatedId, setRelatedId] = useState<string>(entry.relatedPlayerId ?? '');
  const [dorsal, setDorsal] = useState<string>(
    entry.rivalDorsal != null ? String(entry.rivalDorsal) : '',
  );

  const isRival = entry.side === 'rival';
  const isSub = entry.type === 'substitution';
  // Eventos propios con jugador asignable (no por ubicación ni de equipo/táctica).
  const ownHasPlayer =
    entry.side === 'own' &&
    !['corner', 'offside', 'shot', 'formation_change'].includes(entry.type);

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-background/60 p-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span>{t('timeline.field_minute')}</span>
        <input
          type="number"
          min={0}
          max={130}
          value={minute}
          onChange={(ev) => setMinute(Number(ev.target.value))}
          className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
        />
      </label>

      {ownHasPlayer && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{isSub ? t('timeline.field_player_out') : t('timeline.field_player')}</span>
          <select
            value={playerId}
            onChange={(ev) => setPlayerId(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            <option value="">—</option>
            {rosterPlayers.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {isSub && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_player_in')}</span>
          <select
            value={relatedId}
            onChange={(ev) => setRelatedId(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            <option value="">—</option>
            {rosterPlayers.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {isRival && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_dorsal')}</span>
          <input
            type="number"
            min={1}
            max={99}
            value={dorsal}
            onChange={(ev) => setDorsal(ev.target.value)}
            className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          />
        </label>
      )}

      <div className="flex gap-1.5">
        {minute !== minuteOf(entry) && (
          <Button type="button" size="sm" disabled={pending} onClick={() => onMinute(minute)}>
            {t('timeline.save_minute')}
          </Button>
        )}
        {ownHasPlayer && playerId && playerId !== (entry.playerId ?? '') && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onActor({ player_id: playerId })}
          >
            {t('timeline.save_player')}
          </Button>
        )}
        {isSub && relatedId && relatedId !== (entry.relatedPlayerId ?? '') && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onActor({ related_player_id: relatedId })}
          >
            {t('timeline.save_player_in')}
          </Button>
        )}
        {isRival && dorsal && Number(dorsal) !== entry.rivalDorsal && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onActor({ rival_dorsal: Number(dorsal) })}
          >
            {t('timeline.save_dorsal')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta de un evento olvidado.
// ─────────────────────────────────────────────────────────────────────────────

type AddInput = {
  event_id: string;
  id: string;
  side: 'own' | 'rival';
  type: string;
  display_minute: number;
  player_id?: string;
  rival_dorsal?: number;
  outcome?: string;
  foul_kind?: string;
  corner_side?: string;
};

function AddEventForm({
  eventId,
  rosterPlayers,
  defaultMinute,
  pending,
  onSubmit,
}: {
  eventId: string;
  rosterPlayers: RosterPlayer[];
  defaultMinute: number;
  pending: boolean;
  onSubmit: (input: AddInput) => void;
}) {
  const t = useTranslations('partido_directo');
  const [type, setType] = useState<string>('goal');
  const [side, setSide] = useState<'own' | 'rival'>('own');
  const [minute, setMinute] = useState<number>(defaultMinute);
  const [playerId, setPlayerId] = useState<string>('');
  const [dorsal, setDorsal] = useState<string>('');
  const [outcome, setOutcome] = useState<string>('scored');
  const [foulKind, setFoulKind] = useState<string>('committed');
  const [cornerSide, setCornerSide] = useState<string>('for');

  const addable = TIMELINE_ADD_TYPES.filter((ty) => !NON_ADDABLE.has(ty));

  // Reglas de UI por tipo (espejo de addTimelineEventSchema).
  const teamEvent = type === 'foul' || type === 'corner'; // siempre 'own'
  const effectiveSide: 'own' | 'rival' = teamEvent ? 'own' : side;
  const assistOnlyOwn = type === 'assist';
  const ownByLocation = type === 'offside' || type === 'shot' || type === 'corner';
  const needsPlayer = effectiveSide === 'own' && !ownByLocation && type !== 'corner';
  const needsDorsal = effectiveSide === 'rival';

  const canSubmit =
    minute >= 0 &&
    (type === 'corner' ||
      (needsPlayer ? !!playerId : true) && (needsDorsal ? !!dorsal : true));

  const submit = () => {
    const input: AddInput = {
      event_id: eventId,
      id: crypto.randomUUID(),
      side: effectiveSide,
      type,
      display_minute: minute,
    };
    if (needsPlayer && playerId) input.player_id = playerId;
    if (needsDorsal && dorsal) input.rival_dorsal = Number(dorsal);
    if (type === 'penalty') input.outcome = outcome;
    if (type === 'foul') input.foul_kind = foulKind;
    if (type === 'corner') input.corner_side = cornerSide;
    onSubmit(input);
  };

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-background/60 p-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span>{t('timeline.field_type')}</span>
        <select
          value={type}
          onChange={(ev) => {
            const next = ev.target.value;
            setType(next);
            if (next === 'assist') setSide('own');
          }}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
        >
          {addable.map((ty) => (
            <option key={ty} value={ty}>
              {t(`event.${ty}`)}
            </option>
          ))}
        </select>
      </label>

      {!teamEvent && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_side')}</span>
          <select
            value={side}
            disabled={assistOnlyOwn}
            onChange={(ev) => setSide(ev.target.value as 'own' | 'rival')}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground disabled:opacity-50"
          >
            <option value="own">{t('timeline.side_own')}</option>
            {!assistOnlyOwn && <option value="rival">{t('timeline.side_rival')}</option>}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span>{t('timeline.field_minute')}</span>
        <input
          type="number"
          min={0}
          max={130}
          value={minute}
          onChange={(ev) => setMinute(Number(ev.target.value))}
          className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
        />
      </label>

      {needsPlayer && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_player')}</span>
          <select
            value={playerId}
            onChange={(ev) => setPlayerId(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            <option value="">—</option>
            {rosterPlayers.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.dorsal != null ? `${p.dorsal} · ${p.label}` : p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {needsDorsal && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_dorsal')}</span>
          <input
            type="number"
            min={1}
            max={99}
            value={dorsal}
            onChange={(ev) => setDorsal(ev.target.value)}
            className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          />
        </label>
      )}

      {type === 'penalty' && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_outcome')}</span>
          <select
            value={outcome}
            onChange={(ev) => setOutcome(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            {PENALTY_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`penalty_outcome.${o}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === 'foul' && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_foul_kind')}</span>
          <select
            value={foulKind}
            onChange={(ev) => setFoulKind(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            {FOUL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(k === 'received' ? 'foul_received' : 'foul_committed')}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === 'corner' && (
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <span>{t('timeline.field_corner_side')}</span>
          <select
            value={cornerSide}
            onChange={(ev) => setCornerSide(ev.target.value)}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-sm text-foreground"
          >
            {CORNER_SIDES.map((s) => (
              <option key={s} value={s}>
                {t(s === 'against' ? 'event.corner_against' : 'event.corner_for')}
              </option>
            ))}
          </select>
        </label>
      )}

      <Button type="button" size="sm" disabled={pending || !canSubmit} onClick={submit}>
        <Plus className="size-4" aria-hidden /> {t('timeline.add_submit')}
      </Button>
    </div>
  );
}
