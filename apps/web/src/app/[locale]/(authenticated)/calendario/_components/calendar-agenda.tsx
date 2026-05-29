import { getTranslations } from 'next-intl/server';
import { CalendarOff } from 'lucide-react';
import {
  type LocalDay,
  eventLocalDay,
  formatLongDate,
  isSameDay,
  today as todayLocal,
} from '@/lib/calendar-utils';
import { Card, CardContent } from '@/components/ui/card';
import { EventPill } from './event-pill';
import type {
  CalendarEvent,
  CategoryOption,
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
};

export async function CalendarAgenda({
  events,
  locale,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  role,
}: Props) {
  const t = await getTranslations('calendario');
  const today = todayLocal();

  if (events.length === 0) {
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
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of sortedKeys) {
    groups.get(k)!.events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedKeys.map((k) => {
        const grp = groups.get(k)!;
        const isToday = isSameDay(grp.day, today);
        return (
          <section key={k} className="flex flex-col gap-2">
            <h3
              className={
                'sticky top-0 z-10 bg-background/95 py-1 text-sm font-semibold capitalize backdrop-blur ' +
                (isToday ? 'text-foreground' : 'text-muted-foreground')
              }
            >
              {formatLongDate(grp.day, locale)}
              {isToday && (
                <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                  {t('agenda.today')}
                </span>
              )}
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
