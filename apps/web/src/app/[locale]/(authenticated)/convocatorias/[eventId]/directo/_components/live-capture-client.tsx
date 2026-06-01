'use client';

/**
 * F7.2 — Armazón de la pantalla de toma de datos en directo (HORIZONTAL,
 * tablet/portátil táctil tipo Chromebook). SOLO layout: cronómetro (display
 * básico; la lógica avanzada es 7.7), campo, paleta de símbolos de eventos e
 * interruptor equipo/rival.
 *
 * Monta <MatchFieldEditor mode='live-overlay'> (NO lo reescribe): el cronómetro
 * va como overlay absoluto en `children`, y los callbacks onPlayerClick /
 * onFieldClick quedan CABLEADOS como stubs preparados para 7.3 (eventos sobre
 * jugador) y 7.4 (eventos sobre el campo). Aquí no se registra ni persiste nada.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Flag,
  Footprints,
  Goal,
  Square,
  Target,
  Timer,
} from 'lucide-react';
import type { TeamFormat } from '@misterfc/core';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LiveFieldPlayer } from '../queries';

type MatchSide = 'own' | 'rival';

// Tipos de evento de la paleta (coinciden con match_events.type de F7.1). El
// DRAG real de estos símbolos llega en 7.3/7.4; aquí son botones seleccionables.
const EVENT_TYPES = [
  'goal',
  'assist',
  'yellow_card',
  'red_card',
  'substitution',
  'corner',
  'foul',
  'offside',
  'shot',
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_ICON: Record<EventType, typeof Goal> = {
  goal: Goal,
  assist: Footprints,
  yellow_card: Square,
  red_card: Square,
  substitution: ArrowLeftRight,
  corner: Flag,
  foul: AlertTriangle,
  offside: Ban,
  shot: Target,
};

// Color del icono para las tarjetas (resto hereda el color del botón).
const EVENT_ICON_CLASS: Partial<Record<EventType, string>> = {
  yellow_card: 'fill-amber-400 text-amber-500',
  red_card: 'fill-red-500 text-red-600',
};

type Props = {
  eventType: 'match' | 'friendly';
  opponentName: string | null;
  format: TeamFormat;
  formationCode: string;
  fieldPlayers: LiveFieldPlayer[];
  hasOfficialLineup: boolean;
};

export function LiveCaptureClient({
  eventType,
  opponentName,
  format,
  formationCode,
  fieldPlayers,
  hasOfficialLineup,
}: Props) {
  const t = useTranslations('partido_directo');
  const [side, setSide] = useState<MatchSide>('own');
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);

  const players: FieldEditorPlayer[] = fieldPlayers.map((p) => ({
    playerId: p.playerId,
    label: p.label,
    dorsal: p.dorsal,
    photoUrl: p.photoUrl,
    positionCode: p.positionCode,
    xPct: p.xPct,
    yPct: p.yPct,
  }));

  // Stubs de 7.2 — demuestran que live-overlay está cableado. La creación real
  // del evento (selección de jugador/coordenada → match_events) llega en 7.3/7.4.
  function handlePlayerClick(playerId: string) {
    const p = fieldPlayers.find((x) => x.playerId === playerId);
    toast.info(
      t('stub_player', {
        event: selectedEvent ? t(`event.${selectedEvent}`) : t('no_event'),
        player: p?.label ?? playerId,
      }),
    );
  }

  function handleFieldClick(xPct: number, yPct: number) {
    toast.info(
      t('stub_field', {
        event: selectedEvent ? t(`event.${selectedEvent}`) : t('no_event'),
        x: Math.round(xPct),
        y: Math.round(yPct),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Barra superior: cronómetro (display), estado y toggle equipo/rival. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Timer className="size-5 text-muted-foreground" aria-hidden />
            <span
              className="font-mono text-3xl font-semibold tabular-nums"
              aria-label={t('clock_label')}
            >
              00:00
            </span>
          </div>
          <Badge variant="secondary">{t('status_not_started')}</Badge>
          <span className="text-xs text-muted-foreground">
            {t('clock_hint')}
          </span>
        </div>

        {/* Interruptor equipo / rival (segmented). */}
        <div
          role="group"
          aria-label={t('side_label')}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          <button
            type="button"
            onClick={() => setSide('own')}
            aria-pressed={side === 'own'}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              side === 'own'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t('side_own')}
          </button>
          <button
            type="button"
            onClick={() => setSide('rival')}
            aria-pressed={side === 'rival'}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              side === 'rival'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t('side_rival')}
            {opponentName ? ` · ${opponentName}` : ''}
          </button>
        </div>
      </div>

      {/* Cuerpo: paleta | campo | panel lateral. En táctil horizontal las tres
          columnas conviven; en pantallas estrechas se apilan. */}
      <div className="flex flex-col gap-3 lg:flex-row">
        {/* Paleta de símbolos de eventos. */}
        <div className="rounded-lg border border-border bg-card/40 p-3 lg:w-44 lg:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('palette_title')}
          </p>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {EVENT_TYPES.map((ev) => {
              const Icon = EVENT_ICON[ev];
              const active = selectedEvent === ev;
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => setSelectedEvent(active ? null : ev)}
                  aria-pressed={active}
                  className={cn(
                    'flex touch-none flex-col items-center gap-1 rounded-md border p-2 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon
                    className={cn('size-5', EVENT_ICON_CLASS[ev])}
                    aria-hidden
                  />
                  <span className="text-center leading-tight">
                    {t(`event.${ev}`)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-tight text-muted-foreground">
            {t('palette_hint')}
          </p>
        </div>

        {/* Campo con el once oficial. live-overlay: clic en jugador/césped +
            overlay del cronómetro como children. */}
        <div className="flex min-w-0 flex-1 items-start justify-center rounded-lg border border-border bg-card/20 p-3">
          <MatchFieldEditor
            format={format}
            formationCode={formationCode}
            players={players}
            mode="live-overlay"
            onPlayerClick={handlePlayerClick}
            onFieldClick={handleFieldClick}
            // Horizontal: el límite es la altura → dimensionamos por alto
            // (w-auto/max-w-none neutralizan w-full/max-w-md del componente; el
            // aspect-[2/3] base deriva la anchura).
            className="h-[68vh] max-h-[68vh] w-auto max-w-none"
          >
            {/* Overlay absoluto (demuestra el slot `children` de live-overlay). */}
            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-0.5 font-mono text-sm font-semibold tabular-nums text-white">
              00:00
            </div>
          </MatchFieldEditor>
        </div>

        {/* Panel lateral: contexto del bando activo (placeholder de 7.6/7.8). */}
        <div className="rounded-lg border border-border bg-card/40 p-3 lg:w-56 lg:shrink-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {side === 'own' ? t('panel_own_title') : t('panel_rival_title')}
          </p>
          {side === 'rival' ? (
            <p className="text-sm text-muted-foreground">
              {t('panel_rival_hint')}
            </p>
          ) : !hasOfficialLineup ? (
            <p className="text-sm text-muted-foreground">{t('no_lineup')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('panel_own_hint', { count: players.length })}
            </p>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground lg:hidden">
        {t('landscape_hint')}
      </p>
      <p className="text-center text-[11px] text-muted-foreground">
        {eventType === 'friendly' ? t('friendly_note') : t('scope_note')}
      </p>
    </div>
  );
}
