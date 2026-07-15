'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dumbbell,
  Trophy,
  Handshake,
  Circle,
  Goal,
  ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/calendar-utils';
import { EventDialog } from './event-dialog';
import type { CalendarEvent, CategoryOption, TeamOption } from '../queries';

type Props = {
  event: CalendarEvent;
  layout: 'pill' | 'block' | 'card';
  locale: string;
  canManage: boolean;
  manageableTeamIds: string[];
  canManageClubEvents: boolean;
  teams: TeamOption[];
  categories: CategoryOption[];
  /** 12.8a — puede planificar sesiones (botón en eventos training de equipo). */
  canCreateSessions: boolean;
};

const TYPE_ICONS = {
  training: Dumbbell,
  match: Goal,
  tournament: Trophy,
  friendly: Handshake,
  other: Circle,
} as const;

// Fondo + borde por tipo. El TEXTO va aparte (text-foreground): los tonos claros
// previos (text-*-200/100) sobre estos fondos muy suaves (/15) no se leían en el
// tema claro. text-foreground = negro en claro (y blanco en oscuro), legible en
// ambos. El icono y el borde izquierdo siguen aportando el color del tipo/equipo.
const TYPE_BG: Record<CalendarEvent['type'], string> = {
  training: 'bg-emerald-500/15 border-emerald-500/40',
  match: 'bg-sky-500/15 border-sky-500/40',
  tournament: 'bg-amber-500/15 border-amber-500/40',
  friendly: 'bg-indigo-500/15 border-indigo-500/40',
  other: 'bg-zinc-500/15 border-zinc-500/40',
};

export function EventPill({
  event,
  layout,
  locale,
  canManage,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  canCreateSessions,
}: Props) {
  const t = useTranslations('calendario.types');
  const tc = useTranslations('calendario');
  const [open, setOpen] = useState(false);

  const Icon = TYPE_ICONS[event.type];
  const cancelled = event.cancelled_at != null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group flex w-full items-center gap-1.5 overflow-hidden rounded border px-1.5 py-1 text-left text-xs text-foreground transition hover:opacity-90',
          TYPE_BG[event.type],
          layout === 'pill' && 'truncate',
          layout === 'block' && 'rounded-md py-1.5',
          layout === 'card' && 'rounded-md px-3 py-2 text-sm',
          // F14F-1 — entrenamiento cancelado: tachado + atenuado (NO se oculta).
          cancelled && 'line-through opacity-60'
        )}
        style={
          event.team_color
            ? { borderLeftWidth: 3, borderLeftColor: event.team_color }
            : undefined
        }
        aria-label={`${event.title} — ${t(event.type)}${cancelled ? ` (${tc('cancel.badge')})` : ''}`}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        {/* F12.9 — indicador "sesión planificada": junto al icono de pesas, solo
            en entrenamientos con sesión vinculada visible (RLS-aware). */}
        {event.type === 'training' && event.has_session && (
          <span
            className="inline-flex shrink-0"
            title={tc('session_planned')}
            aria-label={tc('session_planned')}
          >
            <ClipboardCheck
              className="size-3 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
          </span>
        )}
        {!event.all_day && (
          <span className="shrink-0 font-mono text-[10px] opacity-80">
            {formatTime(event.starts_at, locale)}
          </span>
        )}
        <span className="truncate">{event.title}</span>
        {cancelled && (
          <span className="shrink-0 rounded bg-destructive/15 px-1 text-[9px] font-semibold uppercase text-destructive no-underline">
            {tc('cancel.badge')}
          </span>
        )}
        {layout === 'card' && event.team_name && (
          <span className="ml-auto shrink-0 text-xs opacity-70">
            {event.team_name}
          </span>
        )}
      </button>

      <EventDialog
        open={open}
        onOpenChange={setOpen}
        mode="edit"
        event={event}
        locale={locale}
        canManage={canManage}
        manageableTeamIds={manageableTeamIds}
        canManageClubEvents={canManageClubEvents}
        teams={teams}
        categories={categories}
        canCreateSessions={canCreateSessions}
      />
    </>
  );
}
