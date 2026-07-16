import { getTranslations } from 'next-intl/server';
import { CalendarOff } from 'lucide-react';
import {
  type LocalDay,
  eventLocalDay,
  formatLongDate,
  isSameDay,
  parseIsoDate,
  today as todayLocal,
} from '@/lib/calendar-utils';
import { Card, CardContent } from '@/components/ui/card';
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
  events: CalendarEvent[];
  locale: string;
  manageableTeamIds: string[];
  canManageClubEvents: boolean;
  teams: TeamOption[];
  categories: CategoryOption[];
  role: string;
  canCreateSessions: boolean;
  /** F14F-2 — opcional: las agendas embebidas (seguidor, ficha staff) no los pasan. */
  holidays?: HolidayInfo[];
  canManageHolidays?: boolean;
};

export async function CalendarAgenda({
  events,
  locale,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  role,
  canCreateSessions,
  holidays = [],
  canManageHolidays = false,
}: Props) {
  const t = await getTranslations('calendario');
  const today = todayLocal();
  const holidayIndex = holidayByDayKey(holidays);
  const canApprove = role === 'admin_club' || role === 'director';

  if (events.length === 0 && holidays.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CalendarOff
            className="size-10 text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            {t('agenda.empty')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Agrupa por LocalDay y ordena por starts_at.
  const groups = new Map<string, { day: LocalDay; events: CalendarEvent[] }>();
  for (const e of events) {
    const d = eventLocalDay(e.starts_at);
    const key = `${d.year}-${d.month}-${d.day}`;
    const entry = groups.get(key) ?? { day: d, events: [] };
    entry.events.push(e);
    groups.set(key, entry);
  }
  // F14F-2 — un festivo marcado por adelantado no tiene eventos: inyecta su día
  // como grupo vacío para que se vea igual en la agenda.
  for (const h of holidays) {
    const [y, m, d] = h.date.split('-').map((n) => parseInt(n, 10));
    if (y == null || m == null || d == null) continue;
    const key = `${y}-${m - 1}-${d}`;
    if (!groups.has(key)) {
      const day = parseIsoDate(h.date);
      if (day) groups.set(key, { day, events: [] });
    }
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of sortedKeys) {
    groups.get(k)!.events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedKeys.map((k) => {
        const grp = groups.get(k)!;
        const isToday = isSameDay(grp.day, today);
        const holiday = holidayIndex.get(k) ?? null;
        return (
          <section key={k} className="group flex flex-col gap-2">
            <h3
              className={
                'sticky top-0 z-10 flex items-center gap-2 bg-background/95 py-1 text-sm font-semibold capitalize backdrop-blur ' +
                (isToday ? 'text-foreground' : 'text-muted-foreground')
              }
            >
              {formatLongDate(grp.day, locale)}
              {isToday && (
                <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                  {t('agenda.today')}
                </span>
              )}
              <HolidayCell
                dateIso={dayIso(grp.day)}
                holiday={holiday}
                canManage={canManageHolidays}
              />
            </h3>
            <div className="flex flex-col gap-1.5">
              {grp.events.map((e) => {
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
                    layout="card"
                    locale={locale}
                    canManage={canManage}
                    manageableTeamIds={manageableTeamIds}
                    canManageClubEvents={canManageClubEvents}
                    canCreateSessions={canCreateSessions}
                    canApprove={canApprove}
                    teams={teams}
                    categories={categories}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
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
