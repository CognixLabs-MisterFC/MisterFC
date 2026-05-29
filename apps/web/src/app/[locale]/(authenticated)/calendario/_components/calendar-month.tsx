import { getTranslations } from 'next-intl/server';
import {
  type LocalDay,
  compareLocalDays,
  eventLocalDay,
  formatDayNumber,
  formatWeekdayShort,
  isSameDay,
  isSameMonth,
  monthGrid,
  today as todayLocal,
} from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';
import { EventPill } from './event-pill';
import type {
  CalendarEvent,
  CategoryOption,
  TeamOption,
} from '../queries';

type Props = {
  pivot: LocalDay;
  events: CalendarEvent[];
  locale: string;
  manageableTeamIds: string[];
  canManageClubEvents: boolean;
  teams: TeamOption[];
  categories: CategoryOption[];
  role: string;
};

const MAX_PILLS_PER_CELL = 3;

export async function CalendarMonth({
  pivot,
  events,
  locale,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  role,
}: Props) {
  const t = await getTranslations('calendario');

  const weeks = monthGrid(pivot);
  const today = todayLocal();

  // Agrupa eventos por LocalDay.
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const d = eventLocalDay(e.starts_at);
    const key = `${d.year}-${d.month}-${d.day}`;
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  const weekdayLabels = weeks[0]!.map((d) => formatWeekdayShort(d, locale));

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="px-2 py-2 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const key = `${day.year}-${day.month}-${day.day}`;
          const dayEvents = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, pivot);
          const isToday = isSameDay(day, today);
          const overflow = dayEvents.length - MAX_PILLS_PER_CELL;
          const canCreate =
            canManageClubEvents || manageableTeamIds.length > 0;
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[110px] flex-col gap-1 border-b border-r border-border p-1.5 sm:min-h-[130px]',
                !inMonth && 'bg-muted/30 text-muted-foreground'
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-xs font-medium',
                    isToday &&
                      'inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background'
                  )}
                >
                  {formatDayNumber(day)}
                </span>
                {canCreate && compareLocalDays(day, today) >= 0 && (
                  <span className="sr-only">{t('new.create_for_day')}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {dayEvents.slice(0, MAX_PILLS_PER_CELL).map((e) => {
                  const canManage = canManageThis(
                    e,
                    role,
                    canManageClubEvents,
                    manageableTeamIds
                  );
                  return (
                    <EventPill
                      key={e.id}
                      event={e}
                      layout="pill"
                      locale={locale}
                      canManage={canManage}
                      manageableTeamIds={manageableTeamIds}
                      canManageClubEvents={canManageClubEvents}
                      teams={teams}
                      categories={categories}
                    />
                  );
                })}
                {overflow > 0 && (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    {t('month.more', { count: overflow })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function canManageThis(
  e: CalendarEvent,
  role: string,
  canManageClubEvents: boolean,
  manageableTeamIds: string[]
): boolean {
  if (role === 'admin_club' || role === 'coordinador') return true;
  if (e.team_id == null) return canManageClubEvents;
  return manageableTeamIds.includes(e.team_id);
}
