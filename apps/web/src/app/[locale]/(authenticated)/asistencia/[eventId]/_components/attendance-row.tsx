'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  ATTENDANCE_PRIMARY_CHIPS,
  ATTENDANCE_SECONDARY_CHIPS,
  type AttendanceCode,
  formatPlayerName,
  otherChipLabel,
} from '@misterfc/core';
import { ArrowUpCircle, ChevronDown, Loader2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { markAttendance, clearAttendance } from '../../actions';

const CODE_ACTIVE: Record<AttendanceCode, string> = {
  presente: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700',
  ausente: 'bg-red-600 text-white border-red-600 hover:bg-red-700',
  ausente_con_aviso:
    'bg-amber-500 text-white border-amber-500 hover:bg-amber-600',
  entreno_diferenciado:
    'bg-sky-500 text-white border-sky-500 hover:bg-sky-600',
  lesionado: 'bg-rose-700 text-white border-rose-700 hover:bg-rose-800',
  enfermo: 'bg-orange-600 text-white border-orange-600 hover:bg-orange-700',
  partido_oficial:
    'bg-violet-600 text-white border-violet-600 hover:bg-violet-700',
  viaje: 'bg-cyan-600 text-white border-cyan-600 hover:bg-cyan-700',
  sancionado: 'bg-zinc-700 text-white border-zinc-700 hover:bg-zinc-800',
  descanso: 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
};

const CODE_DOT: Record<AttendanceCode, string> = {
  presente: 'bg-emerald-600',
  ausente: 'bg-red-600',
  ausente_con_aviso: 'bg-amber-500',
  entreno_diferenciado: 'bg-sky-500',
  lesionado: 'bg-rose-700',
  enfermo: 'bg-orange-600',
  partido_oficial: 'bg-violet-600',
  viaje: 'bg-cyan-600',
  sancionado: 'bg-zinc-700',
  descanso: 'bg-blue-600',
};

type Props = {
  eventId: string;
  playerId: string;
  initialCode: AttendanceCode | null;
  initialNotes: string | null;
  disabled?: boolean;
};

function initials(first: string, last: string | null): string {
  const a = first.trim().charAt(0).toUpperCase();
  const b = (last ?? '').trim().charAt(0).toUpperCase();
  return `${b || a}${a || ''}`.slice(0, 2);
}

export function AttendanceRow({
  eventId,
  playerId,
  initialCode,
  initialNotes,
  disabled = false,
  player,
}: Props & {
  player: {
    first_name: string;
    last_name: string;
    dorsal: number | null;
    is_promoted?: boolean;
    from_team_name?: string | null;
  };
}) {
  const t = useTranslations('asistencia.codes');
  const tRow = useTranslations('asistencia.row');
  const tPromo = useTranslations('promotions');
  const [optimistic, setOptimistic] = useState<AttendanceCode | null>(
    initialCode
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(code: AttendanceCode) {
    if (disabled) return;
    setError(null);
    const prev = optimistic;
    setOptimistic(code);
    startTransition(async () => {
      const r = await markAttendance({
        event_id: eventId,
        player_id: playerId,
        code,
        notes: initialNotes,
      });
      if (r.error) {
        setOptimistic(prev);
        setError(r.error);
      }
    });
  }

  function clear() {
    if (disabled) return;
    setError(null);
    const prev = optimistic;
    setOptimistic(null);
    startTransition(async () => {
      const r = await clearAttendance(eventId, playerId);
      if (r.error) {
        setOptimistic(prev);
        setError(r.error);
      }
    });
  }

  const activeOther = otherChipLabel(optimistic);
  const isOtherActive = activeOther !== null;

  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3">
      {/* Jugador */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
          aria-hidden
        >
          {initials(player.first_name, player.last_name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {formatPlayerName(player.first_name, player.last_name)}
            </span>
            {player.is_promoted && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <ArrowUpCircle className="size-3" aria-hidden />
                {player.from_team_name
                  ? tPromo('badge_from', { team: player.from_team_name })
                  : tPromo('badge')}
              </Badge>
            )}
          </span>
          {player.dorsal != null && (
            <span className="text-xs text-muted-foreground">
              #{player.dorsal}
            </span>
          )}
        </div>
      </div>

      {/* Chips primarios + Otros + Clear */}
      <div
        className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap"
        role="radiogroup"
        aria-label={tRow('group_label', {
          player: `${player.last_name} ${player.first_name}`.trim(),
        })}
      >
        {ATTENDANCE_PRIMARY_CHIPS.map((code) => {
          const active = optimistic === code;
          return (
            <Button
              key={code}
              type="button"
              size="sm"
              variant="outline"
              role="radio"
              aria-checked={active}
              aria-label={t(code)}
              onClick={() => apply(code)}
              disabled={disabled || pending}
              className={cn(
                'h-8 min-w-20 justify-center',
                active && CODE_ACTIVE[code]
              )}
            >
              <span>{t(code)}</span>
            </Button>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-haspopup="menu"
              aria-label={tRow('others_label')}
              disabled={disabled || pending}
              className={cn(
                'h-8 min-w-24 justify-between gap-1',
                isOtherActive && activeOther && CODE_ACTIVE[activeOther]
              )}
            >
              <span className="truncate">
                {isOtherActive && activeOther
                  ? t(activeOther)
                  : tRow('others')}
              </span>
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {ATTENDANCE_SECONDARY_CHIPS.map((code) => (
              <DropdownMenuItem key={code} onClick={() => apply(code)}>
                <span
                  className={cn('mr-2 inline-block size-2 rounded-full', CODE_DOT[code])}
                  aria-hidden
                />
                <span>{t(code)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={clear}
          disabled={disabled || pending || optimistic == null}
          aria-label={tRow('clear')}
          title={tRow('clear')}
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Undo2 className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      {error && (
        <p
          className="basis-full text-xs text-destructive sm:basis-auto"
          role="alert"
        >
          {tRow(`errors.${error}` as 'errors.generic')}
        </p>
      )}
    </li>
  );
}
