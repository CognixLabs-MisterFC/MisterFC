import { getTranslations } from 'next-intl/server';
import {
  type LocalDay,
  eventLocalDay,
  formatDayNumber,
  formatWeekdayShort,
  isSameDay,
  startOfWeek,
  today as todayLocal,
  weekGrid,
} from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';
import { EventPill } from './event-pill';
import { HolidayCell } from './holiday-cell';
import { holidayByDayKey, dayIso } from './holiday-index';
import type {
  CalendarEvent,
  CategoryOption,
  HolidayInfo,
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
  canCreateSessions: boolean;
  holidays: HolidayInfo[];
  canManageHolidays: boolean;
};

export async function CalendarWeek({
  pivot,
  events,
  locale,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  role,
  canCreateSessions,
  holidays,
  canManageHolidays,
}: Props) {
  const t = await getTranslations('calendario');

  const days = weekGrid(startOfWeek(pivot));
  const today = todayLocal();
  const holidayIndex = holidayByDayKey(holidays);

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

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          const holiday = holidayIndex.get(`${d.year}-${d.month}-${d.day}`) ?? null;
          return (
            <div
              key={`${d.year}-${d.month}-${d.day}`}
              className="group flex flex-col items-center gap-0.5 px-2 py-2 text-center text-xs"
            >
              <span className="uppercase tracking-wider text-muted-foreground">
                {formatWeekdayShort(d, locale)}
              </span>
              <span
                className={cn(
                  'mt-0.5 inline-flex size-7 items-center justify-center rounded-full text-base font-semibold',
                  isToday && 'bg-foreground text-background'
                )}
              >
                {formatDayNumber(d)}
              </span>
              <HolidayCell
                dateIso={dayIso(d)}
                holiday={holiday}
                canManage={canManageHolidays}
              />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7 divide-x divide-border">
        {days.map((d) => {
          const key = `${d.year}-${d.month}-${d.day}`;
          const dayEvents = byDay.get(key) ?? [];
          const isHoliday = holidayIndex.has(key);
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[400px] flex-col gap-1.5 p-2',
                isHoliday && 'bg-amber-500/5'
              )}
            >
              {dayEvents.length === 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {t('week.no_events')}
                </span>
              )}
              {dayEvents.map((e) => {
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
                    layout="block"
                    locale={locale}
                    canManage={canManage}
                    manageableTeamIds={manageableTeamIds}
                    canManageClubEvents={canManageClubEvents}
                    canCreateSessions={canCreateSessions}
                    teams={teams}
                    categories={categories}
                  />
                );
              })}
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
