'use client';

/**
 * F7.7c — TANDA de penaltis (desempate, tras la prórroga).
 *
 * Registra CADA lanzamiento como `match_event` type='shootout_penalty' (nuestro:
 * jugador; rival: dorsal; resultado marcado/fallado). El marcador de la tanda se
 * deriva en vivo del motor puro `computeShootout` y sobrevive a F5 (todo en
 * match_events). La tanda es APARTE: no suma minutos ni cuenta como goles del
 * partido. Al cerrar la tanda se FINALIZA el partido (status='closed', 7.7b); el
 * ganador por penaltis queda implícito en los lanzamientos persistidos.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Flag, Trophy } from 'lucide-react';
import {
  clockSecondsAt,
  computeShootout,
  mergeLiveEvents,
  SHOOTOUT_OUTCOMES,
  type ClockPeriod,
  type ScoreEvent,
  type ShootoutOutcome,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { LiveShootoutKick } from '../queries';
import { finishMatch, registerShootoutKick } from '../actions';
import type { StatsPlayer } from './player-stats-strip';

type Props = {
  eventId: string;
  matchStatus: 'not_started' | 'live' | 'closed';
  teamName: string;
  opponentName: string | null;
  players: StatsPlayer[];
  periods: ClockPeriod[];
  shootoutKicks: LiveShootoutKick[];
};

const nowMs = () => Date.now();

export function ShootoutPanel({
  eventId,
  matchStatus,
  teamName,
  opponentName,
  players,
  periods,
  shootoutKicks,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<LiveShootoutKick[]>([]);
  const [shooter, setShooter] = useState<string>('');
  const [rivalDorsal, setRivalDorsal] = useState('');

  const kicks = mergeLiveEvents(shootoutKicks, optimistic).sort(
    (a, b) => a.clockSeconds - b.clockSeconds,
  );
  const tally = computeShootout(
    kicks.map((k): ScoreEvent => ({ side: k.side, type: 'shootout_penalty', outcome: k.outcome })),
  );
  const closed = matchStatus === 'closed';

  const labelOf = (k: LiveShootoutKick) => {
    if (k.side === 'rival') return `#${k.dorsal ?? '—'}`;
    const p = players.find((x) => x.playerId === k.playerId);
    return p?.label ?? k.playerId?.slice(0, 4) ?? '—';
  };

  function registerKick(
    side: 'own' | 'rival',
    outcome: ShootoutOutcome,
    playerId: string | null,
    dorsal: number | null,
  ) {
    if (closed) return;
    const id = crypto.randomUUID();
    const clockSeconds = clockSecondsAt(periods, nowMs());
    const optimisticKick: LiveShootoutKick = {
      id,
      side,
      playerId,
      dorsal,
      outcome,
      clockSeconds,
    };
    setOptimistic((prev) => [...prev, optimisticKick]);
    startTransition(async () => {
      const res = await registerShootoutKick({
        event_id: eventId,
        id,
        side,
        player_id: side === 'own' ? (playerId ?? undefined) : undefined,
        rival_dorsal: side === 'rival' ? (dorsal ?? undefined) : undefined,
        outcome,
      });
      if (res.error) {
        setOptimistic((prev) => prev.filter((k) => k.id !== id));
        toast.error(t(`event_error.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  function ownKick(outcome: ShootoutOutcome) {
    if (!shooter) {
      toast.info(t('shootout_pick_shooter'));
      return;
    }
    registerKick('own', outcome, shooter, null);
  }

  function rivalKick(outcome: ShootoutOutcome) {
    const dorsalNum = Number(rivalDorsal);
    if (!Number.isInteger(dorsalNum) || dorsalNum < 1 || dorsalNum > 99) {
      toast.warning(t('rival_dorsal_required'));
      return;
    }
    registerKick('rival', outcome, null, dorsalNum);
  }

  function closeShootout() {
    if (tally.leader == null) {
      toast.info(t('shootout_tied'));
      return;
    }
    startTransition(async () => {
      const res = await finishMatch({ event_id: eventId });
      if (res.error) {
        toast.error(t(`clock_error.${res.error}`));
        return;
      }
      toast.success(
        t('shootout_finished', {
          winner: tally.leader === 'own' ? teamName : (opponentName ?? t('rival_panel_title')),
        }),
      );
      router.refresh();
    });
  }

  const outcomeBtns = (onPick: (o: ShootoutOutcome) => void) =>
    SHOOTOUT_OUTCOMES.map((o) => (
      <Button
        key={o}
        size="sm"
        variant={o === 'scored' ? 'default' : 'outline'}
        disabled={closed}
        onClick={() => onPick(o)}
      >
        {t(`shootout_outcome.${o}`)}
      </Button>
    ));

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
          <Flag className="size-4" aria-hidden />
          {t('shootout_title')}
        </p>
        {/* Marcador de la tanda (aparte del marcador del partido). */}
        <span className="font-mono text-lg font-bold tabular-nums">
          {t('shootout_score', { own: tally.own, rival: tally.rival })}
        </span>
      </div>

      {tally.leader != null && (
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Trophy className="size-4" aria-hidden />
          {t('shootout_leader', {
            team: tally.leader === 'own' ? teamName : (opponentName ?? t('rival_panel_title')),
          })}
        </p>
      )}

      {!closed && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* NUESTRO lanzamiento. */}
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-2">
            <span className="text-xs font-medium">{teamName}</span>
            <select
              value={shooter}
              onChange={(e) => setShooter(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              aria-label={t('shootout_pick_shooter')}
            >
              <option value="">{t('shootout_pick_shooter')}</option>
              {players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.dorsal != null ? `${p.dorsal} · ` : ''}
                  {p.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5">{outcomeBtns(ownKick)}</div>
          </div>

          {/* RIVAL lanzamiento. */}
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-2">
            <span className="text-xs font-medium text-muted-foreground">
              {opponentName ?? t('rival_panel_title')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rivalDorsal}
              onChange={(e) => setRivalDorsal(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              placeholder={t('rival_dorsal_placeholder')}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-center font-mono text-base tabular-nums text-foreground"
              aria-label={t('rival_dorsal_label')}
            />
            <div className="flex gap-1.5">{outcomeBtns(rivalKick)}</div>
          </div>
        </div>
      )}

      {/* Lanzamientos registrados. */}
      {kicks.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {kicks.map((k, i) => (
            <li
              key={k.id}
              className={cn(
                'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                k.side === 'own' ? 'border-primary/40' : 'border-border',
              )}
            >
              <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className="truncate">{labelOf(k)}</span>
              <span
                className={cn(
                  'font-semibold',
                  k.outcome === 'scored'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400',
                )}
              >
                {k.outcome === 'scored' ? '✓' : '✗'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" disabled={tally.leader == null} onClick={closeShootout}>
            <Trophy className="size-4" aria-hidden />
            <span>{t('shootout_finish')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
