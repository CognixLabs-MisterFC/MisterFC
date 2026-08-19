import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
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
import { useTranslations } from '@/locale/provider';
import { familyEventTarget } from '@/notifications/feed-target';

/** Agenda de las próximas 4 semanas (28 días) desde hoy. */
const AGENDA_DAYS = 28;
/** Máximo de eventos que se listan (los 5 más próximos). Los festivos no cuentan. */
const MAX_EVENTS = 5;

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
  const t = useTranslations('');
  const { activeClub } = useApp();
  const router = useRouter();
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
    const scope = await getCalendarScopeTeamIdsFromClient(sb, clubId);
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
    // Cap a los 5 eventos MÁS PRÓXIMOS (los festivos no cuentan para el límite).
    const capped = [...(data?.events ?? [])]
      .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
      .slice(0, MAX_EVENTS);
    const evs: AgendaItem[] = capped.map((ev) => ({
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
                {`${item.h.date.slice(5)} · ${t('calendario.holidays.badge')} — ${item.h.reason}`}
              </Text>
            </View>
          ) : (
            (() => {
              const target = familyEventTarget(item.ev);
              const body = (
                <>
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
                </>
              );
              return target ? (
                <Pressable
                  onPress={() => router.push(target as Href)}
                  className="mx-4 my-1 flex-row items-center gap-3 border-b border-zinc-100 px-1 py-2 active:opacity-60"
                >
                  {body}
                </Pressable>
              ) : (
                <View className="mx-4 my-1 flex-row items-center gap-3 border-b border-zinc-100 px-1 py-2">
                  {body}
                </View>
              );
            })()
          )
        }
      />
    </View>
  );
}
