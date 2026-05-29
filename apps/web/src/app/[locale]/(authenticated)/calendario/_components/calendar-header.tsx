'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type LocalDay,
  addDays,
  formatMonthLong,
  formatWeekRange,
  formatLongDate,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  today as todayLocal,
  toIsoDate,
} from '@/lib/calendar-utils';
import { Button } from '@/components/ui/button';

type Props = {
  view: 'month' | 'week' | 'agenda';
  pivot: LocalDay;
  locale: string;
};

export function CalendarHeader({ view, pivot, locale }: Props) {
  const t = useTranslations('calendario');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function navigate(nextDay: LocalDay, nextView: 'month' | 'week' | 'agenda') {
    const next = new URLSearchParams(params);
    next.set('view', nextView);
    next.set('date', toIsoDate(nextDay));
    router.replace(`${pathname}?${next.toString()}`);
  }

  function step(direction: -1 | 1) {
    let nextPivot = pivot;
    if (view === 'month') {
      const first = startOfMonth(pivot);
      const last = endOfMonth(pivot);
      nextPivot = direction === -1 ? addDays(first, -1) : addDays(last, 1);
      nextPivot = startOfMonth(nextPivot);
    } else if (view === 'week') {
      nextPivot =
        direction === -1
          ? addDays(startOfWeek(pivot), -7)
          : addDays(endOfWeek(pivot), 1);
    } else {
      // agenda: salto de 28 días
      nextPivot = addDays(pivot, direction * 28);
    }
    navigate(nextPivot, view);
  }

  function goToday() {
    navigate(todayLocal(), view);
  }

  let title = '';
  if (view === 'month') title = formatMonthLong(pivot, locale);
  else if (view === 'week')
    title = formatWeekRange(startOfWeek(pivot), endOfWeek(pivot), locale);
  else title = formatLongDate(pivot, locale);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => step(-1)}
          aria-label={t('nav.prev')}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday}>
          {t('nav.today')}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => step(1)}
          aria-label={t('nav.next')}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <h2 className="ml-2 text-lg font-semibold capitalize">{title}</h2>
      </div>

      <div
        role="tablist"
        aria-label={t('views.label')}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1"
      >
        {(['month', 'week', 'agenda'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => navigate(pivot, v)}
            className={
              'rounded-sm px-3 py-1 text-sm transition ' +
              (view === v
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted')
            }
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
