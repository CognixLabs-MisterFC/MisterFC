'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Trophy, Handshake, Circle, Goal } from 'lucide-react';
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
};

const TYPE_ICONS = {
  training: Dumbbell,
  match: Goal,
  tournament: Trophy,
  friendly: Handshake,
  other: Circle,
} as const;

const TYPE_BG: Record<CalendarEvent['type'], string> = {
  training: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  match: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
  tournament: 'bg-amber-500/15 text-amber-100 border-amber-500/40',
  friendly: 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40',
  other: 'bg-zinc-500/15 text-zinc-200 border-zinc-500/40',
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
}: Props) {
  const t = useTranslations('calendario.types');
  const [open, setOpen] = useState(false);

  const Icon = TYPE_ICONS[event.type];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group flex w-full items-center gap-1.5 overflow-hidden rounded border px-1.5 py-1 text-left text-xs transition hover:opacity-90',
          TYPE_BG[event.type],
          layout === 'pill' && 'truncate',
          layout === 'block' && 'rounded-md py-1.5',
          layout === 'card' && 'rounded-md px-3 py-2 text-sm'
        )}
        style={
          event.team_color
            ? { borderLeftWidth: 3, borderLeftColor: event.team_color }
            : undefined
        }
        aria-label={`${event.title} — ${t(event.type)}`}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        {!event.all_day && (
          <span className="shrink-0 font-mono text-[10px] opacity-80">
            {formatTime(event.starts_at, locale)}
          </span>
        )}
        <span className="truncate">{event.title}</span>
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
      />
    </>
  );
}
