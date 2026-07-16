'use client';

/**
 * F14H — ENTRADA RÁPIDA de eventos de partido.
 *
 * Superficie dedicada (enlazada desde el Directo) pensada para un caso real: el
 * entrenador está SOLO con el equipo y no puede apuntar los eventos durante el
 * partido; los mete DESPUÉS, de un tirón. Optimizada para meter muchos seguidos:
 * el formulario (AddEventForm, reusado del TimelineEditor) NO se cierra al enviar
 * (modo cadena), y la lista de lo ya metido queda a la vista.
 *
 * Si el partido nunca se abrió en directo (not_started / sin reloj), primero se
 * "prepara el acta" (prepareMatchSheet): congela el once oficial y siembra las dos
 * partes, dejando el partido en 'closed'. A partir de ahí cada alta RECONSOLIDA las
 * stats sola (el partido sigue cerrado). El gate de rol es el mismo que el Directo
 * (user_can_record_match); no se amplía a nadie.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import type { ClockPeriod } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { TimelineEntry, RosterPlayer } from '../queries';
import { AddEventForm, type AddInput } from './timeline-editor';
import { addMatchEvent, prepareMatchSheet } from '../actions';

type Props = {
  eventId: string;
  matchStatus: 'not_started' | 'live' | 'closed';
  timeline: TimelineEntry[];
  rosterPlayers: RosterPlayer[];
  periods: ClockPeriod[];
  hasOfficialLineup: boolean;
};

function minuteOf(e: TimelineEntry): number {
  return e.displayMinute ?? Math.floor(e.clockSeconds / 60);
}

export function QuickEntryClient({
  eventId,
  matchStatus,
  timeline,
  rosterPlayers,
  periods,
  hasOfficialLineup,
}: Props) {
  const t = useTranslations('partido_directo');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Necesita reloj (periodos) para mapear minuto→parte. Si no se abrió en directo
  // (not_started o sin periodos) → primero "preparar el acta".
  const needsPrepare = matchStatus === 'not_started' || periods.length === 0;

  // Continuar desde el último minuto metido (o 0 si aún no hay nada).
  const defaultMinute = timeline.length
    ? Math.max(0, ...timeline.map(minuteOf))
    : 0;

  const prepare = () => {
    setPending(true);
    setError(null);
    void prepareMatchSheet({ event_id: eventId })
      .then((res) => {
        if (res.error) setError(res.error);
        else startTransition(() => router.refresh());
      })
      .finally(() => setPending(false));
  };

  const onSubmit = (input: AddInput) => {
    setPending(true);
    setError(null);
    return addMatchEvent(input)
      .then((res) => {
        if (res.error) setError(res.error);
        else startTransition(() => router.refresh());
        return res;
      })
      .finally(() => setPending(false));
  };

  // ── Paso "preparar acta" (partido que nunca se abrió en directo) ──────────────
  if (needsPrepare) {
    return (
      <div className="rounded-lg border border-border bg-card/30 p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <ClipboardList className="size-4" aria-hidden />
          {t('quick.prepare_title')}
        </p>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('quick.prepare_explain')}
        </p>
        {error && (
          <p className="mb-3 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
            {t('timeline.error')}: {error}
          </p>
        )}
        {!hasOfficialLineup ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>{t('quick.needs_official_lineup')}</span>
          </div>
        ) : (
          <Button type="button" onClick={prepare} disabled={pending}>
            <ClipboardList className="size-4" aria-hidden />
            {t('quick.prepare_cta')}
          </Button>
        )}
      </div>
    );
  }

  // ── Entrada en cadena + acta a la vista ──────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-card/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('quick.add_title')}
        </p>
        {error && (
          <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
            {t('timeline.error')}: {error}
          </p>
        )}
        <AddEventForm
          eventId={eventId}
          rosterPlayers={rosterPlayers}
          defaultMinute={defaultMinute}
          pending={pending}
          onSubmit={onSubmit}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('quick.chain_hint')}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('timeline.title')}{' '}
          <span className="text-muted-foreground/70">
            {t('timeline.count', { n: timeline.length })}
          </span>
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('timeline.empty')}</p>
        ) : (
          <ol className="flex max-h-[26rem] flex-col overflow-y-auto">
            {timeline.map((e) => {
              const actor =
                e.side === 'rival'
                  ? e.rivalDorsal != null
                    ? `#${e.rivalDorsal}`
                    : null
                  : e.type === 'substitution'
                    ? t('timeline.sub_arrow', {
                        out: e.playerLabel ?? '—',
                        in: e.relatedPlayerLabel ?? '—',
                      })
                    : (e.playerLabel ?? null);
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-0"
                >
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {t('clock_minute', { minute: minuteOf(e) })}
                  </span>
                  <span className="text-sm text-foreground">
                    {t(`event.${e.type}`)}
                  </span>
                  {actor && (
                    <span className="text-sm text-muted-foreground">{actor}</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
