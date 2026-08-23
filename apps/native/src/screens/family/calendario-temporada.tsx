import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { familyEventTarget, type FamilyTarget } from '@/notifications/feed-target';
import { EventCard, HolidayRow } from '@/screens/family/calendario';

const pad = (n: number) => String(n).padStart(2, '0');
/** Clave de día LOCAL 'YYYY-MM-DD' (mismo criterio local que la agenda). */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Índice de columna con SEMANA EMPEZANDO EN LUNES (getDay: 0=Dom..6=Sáb → 0=Lun..6=Dom). */
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;
/** Cabecera de la rejilla, lunes→domingo, en índices getDay() para el catálogo. */
const WEEK_HEADER = [1, 2, 3, 4, 5, 6, 0];

/**
 * 18-F1 — Vista de TEMPORADA · MES. Rejilla 6×7 a mano (sin librería), navegación
 * mes a mes, marcado de días con evento y de festivos (distinguibles), y lista del
 * día seleccionado bajo la rejilla reutilizando `EventCard`/`HolidayRow` de la agenda.
 *
 * Un fetch por mes con los loaders existentes (rango arbitrario, sin límite) y caché
 * PROPIA `calendar-month:<club>:<YYYY-MM>` (separada de la agenda `calendar:<club>`).
 * Parametrizable (`eventTarget`, `teamId`) para reutilizar en staff/dirección (F3);
 * en este PR se monta SOLO en familia (default `familyEventTarget`, `teamId=null`).
 */
export function CalendarTemporadaScreen({
  eventTarget = familyEventTarget,
  teamId = null,
}: {
  eventTarget?: (ev: CalendarEvent) => FamilyTarget;
  teamId?: string | null;
} = {}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  // Día seleccionado ('YYYY-MM-DD'): hoy si arrancamos en el mes actual; al cambiar de
  // mes se limpia (se pide tocar un día).
  const [selectedDay, setSelectedDay] = useState<string | null>(() => dayKey(today));

  const monthTag = `${viewYear}-${pad(viewMonth + 1)}`;

  // Rango del mes [1er día, 1er día del mes siguiente) y fechas de festivos.
  const range = useMemo(() => {
    const start = new Date(viewYear, viewMonth, 1);
    const end = new Date(viewYear, viewMonth + 1, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      fromDate: dayKey(start),
      toDate: dayKey(lastDay),
      daysInMonth: lastDay.getDate(),
      leadingBlanks: mondayIndex(start.getDay()),
    };
  }, [viewYear, viewMonth]);

  const { data, fromCache, loading } = useCached<{
    events: CalendarEvent[];
    holidays: HolidayInfo[];
  }>(
    teamId
      ? clubScopedCacheKey('calendar-month-team', `${clubId ?? 'none'}:${teamId}:${monthTag}`)
      : clubScopedCacheKey('calendar-month', `${clubId ?? 'none'}:${monthTag}`),
    async (sb) => {
      if (!clubId) return { events: [], holidays: [] };
      const { events } = await getCalendarDataFromClient(
        sb,
        clubId,
        { startIso: range.startIso, endIso: range.endIso },
        { teamIds: teamId ? [teamId] : [], categoryIds: [], types: [] },
        teamId ? {} : { scopeTeamIds: await getCalendarScopeTeamIdsFromClient(sb, clubId) },
      );
      const holidays = await getHolidaysFromClient(sb, clubId, range.fromDate, range.toDate);
      return { events, holidays };
    },
  );

  // Índices por día: qué días tienen evento / son festivo, y el detalle del día tocado.
  const { eventDays, holidayDays, dayEvents, dayHolidays } = useMemo(() => {
    const evByDay = new Map<string, CalendarEvent[]>();
    for (const ev of data?.events ?? []) {
      const k = dayKey(new Date(ev.starts_at));
      const arr = evByDay.get(k) ?? [];
      arr.push(ev);
      evByDay.set(k, arr);
    }
    const holByDay = new Map<string, HolidayInfo[]>();
    for (const h of data?.holidays ?? []) {
      const arr = holByDay.get(h.date) ?? [];
      arr.push(h);
      holByDay.set(h.date, arr);
    }
    const sel = selectedDay;
    const evs = sel
      ? [...(evByDay.get(sel) ?? [])].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
      : [];
    return {
      eventDays: new Set(evByDay.keys()),
      holidayDays: new Set(holByDay.keys()),
      dayEvents: evs,
      dayHolidays: sel ? holByDay.get(sel) ?? [] : [],
    };
  }, [data, selectedDay]);

  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDay(null);
  };

  if (loading) return <LoadingScreen />;

  // Celdas de la rejilla: nulls de relleno + números de día.
  const cells: (number | null)[] = [
    ...Array.from({ length: range.leadingBlanks }, () => null),
    ...Array.from({ length: range.daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Cabecera: mes + navegación. */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <NavArrow label="‹" onPress={() => goMonth(-1)} />
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {`${t(`calendario.date.month.${viewMonth}`)} ${viewYear}`}
          </Text>
          <NavArrow label="›" onPress={() => goMonth(1)} />
        </View>

        {/* Cabecera de días de semana (lunes→domingo). */}
        <View className="flex-row px-2">
          {WEEK_HEADER.map((wd) => (
            <View key={wd} className="flex-1 items-center py-1">
              <Text className="text-[11px] font-semibold uppercase text-zinc-400">
                {t(`calendario.date.weekday_short.${wd}`)}
              </Text>
            </View>
          ))}
        </View>

        {/* Rejilla 6×7. */}
        <View className="px-2">
          {rows.map((row, ri) => (
            <View key={ri} className="flex-row">
              {row.map((day, ci) => {
                if (day == null) return <View key={ci} className="flex-1 aspect-square" />;
                const ds = `${monthTag}-${pad(day)}`;
                const hasEvent = eventDays.has(ds);
                const isHoliday = holidayDays.has(ds);
                const isSelected = selectedDay === ds;
                return (
                  <Pressable
                    key={ci}
                    onPress={() => setSelectedDay(ds)}
                    className="flex-1 aspect-square items-center justify-center"
                  >
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        isSelected ? '' : isHoliday ? 'bg-amber-100' : ''
                      }`}
                      style={isSelected ? { backgroundColor: accent } : undefined}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected
                            ? 'font-bold text-white'
                            : isHoliday
                              ? 'font-semibold text-amber-800'
                              : 'text-[#0F1B2E]'
                        }`}
                      >
                        {day}
                      </Text>
                    </View>
                    {/* Marca de "tiene evento": punto bajo el número (sin contar cuántos). */}
                    <View
                      className="mt-0.5 h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: hasEvent && !isSelected ? accent : 'transparent',
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Lista del día seleccionado. */}
        <View className="mt-3">
          {selectedDay == null ? (
            <Text className="px-4 py-6 text-center text-sm text-zinc-400">
              {t('calendario.month.select_day')}
            </Text>
          ) : dayHolidays.length === 0 && dayEvents.length === 0 ? (
            <Text className="px-4 py-6 text-center text-sm text-zinc-400">
              {t('calendario.month.empty_day')}
            </Text>
          ) : (
            <>
              {dayHolidays.map((h) => (
                <HolidayRow key={`h:${h.id}`} h={h} t={t} />
              ))}
              {dayEvents.map((ev) => {
                const target = eventTarget(ev);
                return (
                  <EventCard
                    key={`e:${ev.id}`}
                    ev={ev}
                    t={t}
                    accent={accent}
                    onPress={target ? () => router.push(target as Href) : undefined}
                  />
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function NavArrow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      className="h-9 w-9 items-center justify-center rounded-full border border-zinc-200 active:opacity-60"
    >
      <Text className="text-lg font-bold text-[#0F1B2E]">{label}</Text>
    </Pressable>
  );
}
