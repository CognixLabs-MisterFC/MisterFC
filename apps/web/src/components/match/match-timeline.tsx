/**
 * Línea de tiempo del partido — representación READ-ONLY compartida.
 *
 * Reusa la MISMA representación y las MISMAS claves i18n (`partido_directo.*`)
 * que la línea editable del directo (F7.9, `timeline-editor.tsx`): minuto +
 * bando (own/rival) + descripción del evento + actor. Aquí sin edición ni
 * server actions — la consume la vista de estadísticas del partido (F7.x X.2).
 *
 * Server component: solo lectura, sin estado. Recibe los eventos ya proyectados
 * y ordenados (ascendente por reloj). No accede a datos.
 */

import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

export type MatchTimelineEntry = {
  id: string;
  side: 'own' | 'rival';
  type: string;
  displayMinute: number | null;
  clockSeconds: number;
  /** Actor propio ya formateado (p.ej. "9 · Pedro Sánchez"). */
  playerLabel: string | null;
  rivalDorsal: number | null;
  /** Sustitución: el que ENTRA, ya formateado. */
  relatedPlayerLabel: string | null;
  outcome: string | null;
  foulKind: string | null;
  cornerSide: string | null;
  formationFrom: string | null;
  formationTo: string | null;
};

function minuteOf(e: MatchTimelineEntry): number {
  return e.displayMinute ?? Math.floor(e.clockSeconds / 60);
}

export async function MatchTimeline({
  entries,
}: {
  entries: MatchTimelineEntry[];
}) {
  // Mismo namespace que la línea del directo: reusa event.*, foul_*, corner_*,
  // penalty_outcome.*, formation_change_event, clock_minute y timeline.side_*.
  const t = await getTranslations('partido_directo');

  function describe(e: MatchTimelineEntry): string {
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
        return `${t('event.foul')} · ${t(
          e.foulKind === 'received' ? 'foul_received' : 'foul_committed',
        )}`;
      case 'corner':
        return `${t('event.corner')} · ${t(
          e.cornerSide === 'against' ? 'event.corner_against' : 'event.corner_for',
        )}`;
      case 'penalty':
        return `${t('event.penalty')}${
          e.outcome ? ` · ${t(`penalty_outcome.${e.outcome}`)}` : ''
        }`;
      case 'shootout_penalty':
        return `${t('timeline.shootout')}${
          e.outcome ? ` · ${t(`shootout_outcome.${e.outcome}`)}` : ''
        }`;
      default:
        return t(`event.${e.type}`);
    }
  }

  function actorText(e: MatchTimelineEntry): string | null {
    if (e.side === 'rival')
      return e.rivalDorsal != null ? `#${e.rivalDorsal}` : null;
    return e.playerLabel;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('timeline.empty')}</p>;
  }

  return (
    <ol className="flex max-h-[28rem] flex-col overflow-y-auto">
      {entries.map((e) => {
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
