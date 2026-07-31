import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import {
  getCalendarDataFromClient,
  getCalendarScopeTeamIdsFromClient,
  getHolidaysFromClient,
  clubScopedCacheKey,
  type CalendarEvent,
  type HolidayInfo,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { t } from '@/i18n';

/** Agenda de las próximas 4 semanas (28 días) desde hoy. */
const AGENDA_DAYS = 28;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type AgendaItem =
  | { kind: 'event'; key: string; sortKey: string; ev: CalendarEvent }
  | { kind: 'holiday'; key: string; sortKey: string; h: HolidayInfo };

const TYPE_ICON: Record<string, string> = {
  training: '🏋️',
  match: '⚽',
  friendly: '⚽',
  tournament: '🏆',
  other: '📌',
};

/**
 * O2-5 B1 — Calendario (agenda): eventos + festivos de las próximas 4 semanas,
 * acotados a los equipos de los hijos (scope). Club-scoped (clubId en la key).
 * Vista de agenda (lista por día); sin las 3 vistas de la web.
 */
export function CalendarioScreen() {
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(start.getDate() + AGENDA_DAYS);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      fromDate: isoDate(start),
      toDate: isoDate(end),
    };
  }, []);

  const { data, fromCache, loading } = useCached<{
    events: CalendarEvent[];
    holidays: HolidayInfo[];
  }>(clubScopedCacheKey('calendar', clubId ?? 'none'), async (sb) => {
    if (!clubId) return { events: [], holidays: [] };
    const scope = await getCalendarScopeTeamIdsFromClient(sb);
    const { events } = await getCalendarDataFromClient(
      sb,
      clubId,
      { startIso: range.startIso, endIso: range.endIso },
      { teamIds: [], categoryIds: [], types: [] },
      { scopeTeamIds: scope },
    );
    const holidays = await getHolidaysFromClient(sb, clubId, range.fromDate, range.toDate);
    return { events, holidays };
  });

  const items: AgendaItem[] = useMemo(() => {
    const evs: AgendaItem[] = (data?.events ?? []).map((ev) => ({
      kind: 'event',
      key: `e:${ev.id}`,
      sortKey: ev.starts_at,
      ev,
    }));
    const hols: AgendaItem[] = (data?.holidays ?? []).map((h) => ({
      kind: 'holiday',
      key: `h:${h.id}`,
      sortKey: `${h.date}T00:00:00.000Z`,
      h,
    }));
    return [...evs, ...hols].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  }, [data]);

  if (loading) return <LoadingScreen />;
  if (items.length === 0) return <EmptyState message={t('calendario.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) =>
          item.kind === 'holiday' ? (
            <View className="mx-4 my-1 rounded-xl bg-amber-50 px-4 py-2">
              <Text className="text-sm font-medium text-amber-800">
                {`${item.h.date.slice(5)} · ${t('calendario.holiday')} — ${item.h.reason}`}
              </Text>
            </View>
          ) : (
            <View className="mx-4 my-1 flex-row items-center gap-3 border-b border-zinc-100 px-1 py-2">
              <Text className="text-lg">{TYPE_ICON[item.ev.type] ?? '📌'}</Text>
              <View className="flex-1">
                <Text
                  className={`text-sm font-medium ${item.ev.cancelled_at ? 'text-zinc-400 line-through' : 'text-[#0F1B2E]'}`}
                  numberOfLines={1}
                >
                  {item.ev.title}
                </Text>
                <Text className="text-xs text-zinc-400">
                  {`${item.ev.starts_at.slice(5, 10)} ${item.ev.starts_at.slice(11, 16)}${item.ev.team_name ? ' · ' + item.ev.team_name : ''}`}
                </Text>
              </View>
            </View>
          )
        }
      />
    </View>
  );
}
