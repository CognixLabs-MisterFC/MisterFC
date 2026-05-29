'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  ATTENDANCE_CODES,
  type AttendanceCode,
  nextQuickCycle,
} from '@misterfc/core';
import { Loader2, MoreHorizontal, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { markAttendance, clearAttendance } from '../../actions';

const CODE_COLOR: Record<AttendanceCode, string> = {
  presente: 'bg-emerald-600 text-white hover:bg-emerald-700',
  ausente: 'bg-red-600 text-white hover:bg-red-700',
  ausente_con_aviso: 'bg-amber-500 text-white hover:bg-amber-600',
  entreno_diferenciado: 'bg-sky-500 text-white hover:bg-sky-600',
  lesionado: 'bg-rose-700 text-white hover:bg-rose-800',
  enfermo: 'bg-orange-600 text-white hover:bg-orange-700',
  partido_oficial: 'bg-violet-600 text-white hover:bg-violet-700',
  viaje: 'bg-cyan-600 text-white hover:bg-cyan-700',
  sancionado: 'bg-zinc-700 text-white hover:bg-zinc-800',
  descanso: 'bg-blue-600 text-white hover:bg-blue-700',
};

type Props = {
  eventId: string;
  playerId: string;
  current: AttendanceCode | null;
  disabled?: boolean;
};

export function AttendanceMarker({
  eventId,
  playerId,
  current,
  disabled = false,
}: Props) {
  const t = useTranslations('asistencia.codes');
  const tCommon = useTranslations('asistencia.marker');
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<AttendanceCode | null>(current);
  const [error, setError] = useState<string | null>(null);

  function applyCode(code: AttendanceCode) {
    setError(null);
    const prev = optimistic;
    setOptimistic(code);
    startTransition(async () => {
      const r = await markAttendance({
        event_id: eventId,
        player_id: playerId,
        code,
      });
      if (r.error) {
        setOptimistic(prev);
        setError(r.error);
      }
    });
  }

  function clear() {
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

  function cycleQuick() {
    if (disabled) return;
    applyCode(nextQuickCycle(optimistic));
  }

  const label = optimistic ? t(optimistic) : tCommon('unmarked');
  const colorClass = optimistic
    ? CODE_COLOR[optimistic]
    : 'bg-muted text-muted-foreground hover:bg-muted/80';

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        onClick={cycleQuick}
        disabled={disabled || pending}
        className={`${colorClass} min-w-28 justify-center`}
        title={tCommon('cycle_hint')}
      >
        {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
        <span className="truncate">{label}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled || pending}
            aria-label={tCommon('more')}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{tCommon('pick_code')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ATTENDANCE_CODES.map((code) => (
            <DropdownMenuItem key={code} onClick={() => applyCode(code)}>
              <span
                className={`mr-2 inline-block size-2 rounded-full ${CODE_COLOR[code].split(' ')[0]}`}
                aria-hidden
              />
              <span>{t(code)}</span>
            </DropdownMenuItem>
          ))}
          {optimistic != null && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clear}
                className="text-destructive focus:text-destructive"
              >
                <Undo2 className="mr-2 size-3.5" aria-hidden />
                <span>{tCommon('clear')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <span className="text-xs text-destructive" role="alert">
          {tCommon(`errors.${error}` as 'errors.generic')}
        </span>
      )}
    </div>
  );
}
