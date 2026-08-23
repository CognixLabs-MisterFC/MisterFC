import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
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

/** Traducción con la firma del hook `useTranslations('')` (namespace raíz). */
type T = (key: string, values?: Record<string, string>) => string;

const pad = (n: number) => String(n).padStart(2, '0');
/** Clave de día LOCAL 'YYYY-MM-DD' (mismo criterio local que la agenda). */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Índice de columna con SEMANA EMPEZANDO EN LUNES (getDay: 0=Dom..6=Sáb → 0=Lun..6=Dom). */
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;
/** Cabecera de la rejilla, lunes→domingo, en índices getDay() para el catálogo. */
const WEEK_HEADER = [1, 2, 3, 4, 5, 6, 0];

const TYPE_ICON: Record<string, string> = {
  training: '🏋️',
  match: '⚽',
  friendly: '⚽',
  tournament: '🏆',
  other: '📌',
};

type SubTab = 'month' | 'day';

/**
 * 18-F1/F2 — Vista de TEMPORADA. Wrapper con sub-selector MES/DÍA que POSEE el estado
 * de mes/año, el día seleccionado y el FETCH mensual (caché `calendar-month:…`). Abre en
 * MES (comportamiento de F1). Tanto MES como DÍA leen de ese mismo `data` → un único fetch
 * por mes; deslizar a un día de otro mes mueve el mes visible y reaprovecha su caché.
 *
 * Parametrizable (`eventTarget`, `teamId`) para reutilizar en staff/dirección (F3); en este
 * PR se monta SOLO en familia (default `familyEventTarget`, `teamId=null`).
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
  const [subTab, setSubTab] = useState<SubTab>('month');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  // Día seleccionado ('YYYY-MM-DD'): hoy si arrancamos en el mes actual; al cambiar de
  // mes se limpia (en MES se pide tocar un día).
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

  // Día concreto para la vista DÍA: el seleccionado o, si no hay, hoy (si el mes visible es
  // el actual) o el día 1 del mes visible.
  const effectiveDay = useMemo(() => {
    if (selectedDay) return selectedDay;
    const sameMonth = today.getFullYear() === viewYear && today.getMonth() === viewMonth;
    return sameMonth ? dayKey(today) : `${monthTag}-01`;
  }, [selectedDay, viewYear, viewMonth, monthTag, today]);

  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDay(null);
  };

  // Deslizar/navegar entre días. Mueve el día y, si cruza de mes, el mes visible → el fetch
  // sigue al día (reaprovecha la caché del mes si es el mismo).
  const goDay = useCallback(
    (delta: number) => {
      const base = new Date(`${effectiveDay}T12:00:00`);
      base.setDate(base.getDate() + delta);
      setSelectedDay(dayKey(base));
      setViewYear(base.getFullYear());
      setViewMonth(base.getMonth());
    },
    [effectiveDay],
  );

  const openDayTab = () => {
    if (!selectedDay) setSelectedDay(effectiveDay);
    setSubTab('day');
  };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      {/* Sub-selector MES / DÍA. */}
      <View className="flex-row gap-2 px-4 pb-1 pt-2">
        <SubTabChip
          label={t('calendario.season.tabs.month')}
          on={subTab === 'month'}
          accent={accent}
          onPress={() => setSubTab('month')}
        />
        <SubTabChip
          label={t('calendario.season.tabs.day')}
          on={subTab === 'day'}
          accent={accent}
          onPress={openDayTab}
        />
      </View>

      {loading ? (
        <LoadingScreen />
      ) : subTab === 'month' ? (
        <MonthView
          viewYear={viewYear}
          viewMonth={viewMonth}
          monthTag={monthTag}
          leadingBlanks={range.leadingBlanks}
          daysInMonth={range.daysInMonth}
          eventDays={eventDays}
          holidayDays={holidayDays}
          selectedDay={selectedDay}
          dayEvents={dayEvents}
          dayHolidays={dayHolidays}
          accent={accent}
          t={t}
          onGoMonth={goMonth}
          onSelectDay={setSelectedDay}
          onOpenEvent={(ev) => {
            const target = eventTarget(ev);
            if (target) router.push(target as Href);
          }}
        />
      ) : (
        <DayView
          // key por día: el rango ajustado (8-24) vive SOLO mientras miras ESE día. Al
          // cambiar de día (o volver de MES) el componente se remonta y el rango se reinicia
          // — decisión de Jose: nadie debe llevarse un 16-22 al día siguiente y perderse el
          // partido de las 9.
          key={effectiveDay}
          day={effectiveDay}
          events={dayEvents}
          holidays={dayHolidays}
          accent={accent}
          t={t}
          onGoDay={goDay}
          onOpenEvent={(ev) => {
            const target = eventTarget(ev);
            if (target) router.push(target as Href);
          }}
        />
      )}
    </View>
  );
}

/* ────────────────────────────── Vista MES (18-F1, extraída sin cambios) ───────────────── */

function MonthView({
  viewYear,
  viewMonth,
  monthTag,
  leadingBlanks,
  daysInMonth,
  eventDays,
  holidayDays,
  selectedDay,
  dayEvents,
  dayHolidays,
  accent,
  t,
  onGoMonth,
  onSelectDay,
  onOpenEvent,
}: {
  viewYear: number;
  viewMonth: number;
  monthTag: string;
  leadingBlanks: number;
  daysInMonth: number;
  eventDays: Set<string>;
  holidayDays: Set<string>;
  selectedDay: string | null;
  dayEvents: CalendarEvent[];
  dayHolidays: HolidayInfo[];
  accent: string;
  t: T;
  onGoMonth: (delta: number) => void;
  onSelectDay: (ds: string) => void;
  onOpenEvent: (ev: CalendarEvent) => void;
}) {
  // Celdas de la rejilla: nulls de relleno + números de día.
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Cabecera: mes + navegación. */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <NavArrow label="‹" onPress={() => onGoMonth(-1)} />
        <Text className="text-lg font-bold text-[#0F1B2E]">
          {`${t(`calendario.date.month.${viewMonth}`)} ${viewYear}`}
        </Text>
        <NavArrow label="›" onPress={() => onGoMonth(1)} />
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
                  onPress={() => onSelectDay(ds)}
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
            {dayEvents.map((ev) => (
              <EventCard
                key={`e:${ev.id}`}
                ev={ev}
                t={t}
                accent={accent}
                onPress={() => onOpenEvent(ev)}
              />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

/* ────────────────────────────── Vista DÍA (18-F2) ─────────────────────────────────────── */

const HOUR_H = 56; // alto en px de una hora de la rejilla
const MIN_BLOCK_H = 28; // alto mínimo para que quepa la hora + tipo en eventos cortos
const DEFAULT_DUR_MIN = 60; // duración asumida si no hay ends_at (o es inválido)
const GUTTER = 48; // ancho de la columna de etiquetas de hora
const DEFAULT_START = 8;
const DEFAULT_END = 24;
const MIN_SPAN = 2; // horas mínimas visibles

/** Minutos LOCALES desde medianoche de un ISO. */
const minutesOf = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/** Hora HH:MM en formato del dispositivo (respeta 12/24h, como el resto de la app). */
const clockOfIso = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const clockOfHour = (h: number) => {
  const d = new Date(2000, 0, 1);
  d.setHours(h % 24, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

type Timed = { ev: CalendarEvent; startMin: number; endMin: number; col: number; colCount: number };

/**
 * Reparto en CARRILES (estilo Outlook/Google): agrupa los eventos que se solapan en el
 * tiempo y, dentro de cada clúster, asigna la primera columna libre. Dos entrenamientos a
 * la misma hora → dos columnas lado a lado. Se calcula sobre TODOS los eventos con hora del
 * día (aunque queden fuera del rango visible) para que las columnas no bailen al ajustar.
 */
function layoutLanes(events: CalendarEvent[]): Timed[] {
  const items = events.map((ev) => {
    const startMin = minutesOf(ev.starts_at);
    let endMin = startMin + DEFAULT_DUR_MIN;
    if (ev.ends_at) {
      const diff = (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000;
      if (diff > 0) endMin = startMin + diff;
    }
    return { ev, startMin, endMin, col: 0, colCount: 1 };
  });
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: Timed[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const colEnds: number[] = []; // último fin (min) por columna
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.startMin);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(it.endMin);
      } else {
        colEnds[c] = it.endMin;
      }
      it.col = c;
    }
    const colCount = colEnds.length;
    for (const it of cluster) out.push({ ...it, colCount });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}

function DayView({
  day,
  events,
  holidays,
  accent,
  t,
  onGoDay,
  onOpenEvent,
}: {
  day: string; // 'YYYY-MM-DD'
  events: CalendarEvent[];
  holidays: HolidayInfo[];
  accent: string;
  t: T;
  onGoDay: (delta: number) => void;
  onOpenEvent: (ev: CalendarEvent) => void;
}) {
  const [rangeStart, setRangeStart] = useState(DEFAULT_START);
  const [rangeEnd, setRangeEnd] = useState(DEFAULT_END);

  const allDay = events.filter((e) => e.all_day);
  const lanes = useMemo(() => layoutLanes(events.filter((e) => !e.all_day)), [events]);

  const rangeStartMin = rangeStart * 60;
  const rangeEndMin = rangeEnd * 60;
  const gridMin = (rangeEnd - rangeStart) * 60;
  const gridHeight = (rangeEnd - rangeStart) * HOUR_H;

  // Eventos con hora que caen FUERA del rango visible (no se recortan: están enteros fuera).
  const before = lanes.filter((l) => l.endMin <= rangeStartMin).length;
  const after = lanes.filter((l) => l.startMin >= rangeEndMin).length;

  const resetRange = () => {
    setRangeStart(DEFAULT_START);
    setRangeEnd(DEFAULT_END);
  };

  // Deslizar entre días: pan horizontal. `failOffsetY` cede el gesto al scroll vertical de la
  // rejilla; `activeOffsetX` exige movimiento horizontal para activarse.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-16, 16])
        .onEnd((e) => {
          if (e.translationX > 60) runOnJS(onGoDay)(-1);
          else if (e.translationX < -60) runOnJS(onGoDay)(1);
        }),
    [onGoDay],
  );

  const dayDate = new Date(`${day}T12:00:00`);
  const title = `${t(`calendario.date.weekday.${dayDate.getDay()}`)} ${dayDate.getDate()} ${t(
    `calendario.date.month.${dayDate.getMonth()}`,
  )}`;

  const hourLines = [];
  for (let h = rangeStart; h <= rangeEnd; h++) hourLines.push(h);

  return (
    <GestureDetector gesture={swipe}>
      <View className="flex-1">
        {/* Cabecera del día + navegación. */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <NavArrow label="‹" onPress={() => onGoDay(-1)} />
          <Text className="text-base font-bold text-[#0F1B2E]">{title}</Text>
          <NavArrow label="›" onPress={() => onGoDay(1)} />
        </View>

        {/* Ajuste del rango de horas (no persiste: se reinicia por día). */}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2">
          <Stepper
            label={t('calendario.day.range.from')}
            value={rangeStart}
            onDec={() => setRangeStart((v) => Math.max(0, v - 1))}
            onInc={() => setRangeStart((v) => Math.min(rangeEnd - MIN_SPAN, v + 1))}
          />
          <Stepper
            label={t('calendario.day.range.to')}
            value={rangeEnd}
            onDec={() => setRangeEnd((v) => Math.max(rangeStart + MIN_SPAN, v - 1))}
            onInc={() => setRangeEnd((v) => Math.min(24, v + 1))}
          />
          {(rangeStart !== DEFAULT_START || rangeEnd !== DEFAULT_END) && (
            <Pressable onPress={resetRange} hitSlop={8} className="active:opacity-60">
              <Text className="text-xs font-semibold" style={{ color: accent }}>
                {t('calendario.day.range.reset')}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Festivos del día (misma marca ámbar que la agenda). */}
        {holidays.map((h) => (
          <HolidayRow key={`h:${h.id}`} h={h} t={t} />
        ))}

        {/* Eventos de todo el día. */}
        {allDay.length > 0 && (
          <View className="flex-row flex-wrap gap-2 px-4 py-1">
            {allDay.map((ev) => (
              <Pressable
                key={`ad:${ev.id}`}
                onPress={() => onOpenEvent(ev)}
                className="rounded-full border px-3 py-1 active:opacity-70"
                style={{ borderColor: ev.team_color ?? accent }}
              >
                <Text className="text-xs font-semibold text-[#0F1B2E]">
                  {`${TYPE_ICON[ev.type] ?? '📌'} ${t('calendario.day.all_day')} · ${
                    ev.team_name ?? t(`calendario.types.${ev.type}`)
                  }`}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Aviso de eventos por encima del rango visible. */}
        {before > 0 && (
          <OutOfRangeChip
            label={t('calendario.day.before_range', { count: String(before) })}
            onPress={resetRange}
          />
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ height: gridHeight, position: 'relative' }} className="px-2">
            {/* Líneas y etiquetas de hora. */}
            {hourLines.map((h) => (
              <View
                key={h}
                style={{ position: 'absolute', top: (h - rangeStart) * HOUR_H, left: 0, right: 0 }}
              >
                <View className="border-t border-zinc-100" style={{ marginLeft: GUTTER }} />
                <Text
                  style={{ position: 'absolute', top: -7, left: 0, width: GUTTER - 6 }}
                  className="text-right text-[10px] text-zinc-400"
                >
                  {clockOfHour(h)}
                </Text>
              </View>
            ))}

            {/* Bloques de evento (posicionados por hora, ancho por carril). */}
            <View style={{ position: 'absolute', left: GUTTER, right: 6, top: 0, bottom: 0 }}>
              {lanes.map((l) => {
                const topMin = Math.max(0, l.startMin - rangeStartMin);
                const botMin = Math.min(gridMin, l.endMin - rangeStartMin);
                if (botMin <= 0 || topMin >= gridMin || botMin <= topMin) return null; // fuera de rango
                const top = (topMin / 60) * HOUR_H;
                const height = Math.max(MIN_BLOCK_H, ((botMin - topMin) / 60) * HOUR_H);
                const rival =
                  l.ev.type === 'match' || l.ev.type === 'friendly' || l.ev.type === 'tournament'
                    ? l.ev.opponent_name?.trim() || l.ev.title?.trim() || null
                    : null;
                const detail = rival ?? l.ev.team_name ?? null;
                return (
                  <Pressable
                    key={`e:${l.ev.id}`}
                    onPress={() => onOpenEvent(l.ev)}
                    style={{
                      position: 'absolute',
                      top,
                      height,
                      left: `${(l.col / l.colCount) * 100}%`,
                      width: `${(1 / l.colCount) * 100}%`,
                    }}
                  >
                    <View
                      className="mx-0.5 h-full overflow-hidden rounded-lg px-1.5 py-1"
                      style={{
                        backgroundColor: `${(l.ev.team_color ?? accent)}22`,
                        borderLeftWidth: 3,
                        borderLeftColor: l.ev.team_color ?? accent,
                      }}
                    >
                      <Text className="text-[11px] font-semibold text-[#0F1B2E]" numberOfLines={1}>
                        {`${TYPE_ICON[l.ev.type] ?? '📌'} ${clockOfIso(l.ev.starts_at)}`}
                      </Text>
                      {detail && height > MIN_BLOCK_H + 6 ? (
                        <Text className="text-[10px] text-zinc-600" numberOfLines={1}>
                          {detail}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Aviso de eventos por debajo del rango visible. */}
          {after > 0 && (
            <OutOfRangeChip
              label={t('calendario.day.after_range', { count: String(after) })}
              onPress={resetRange}
            />
          )}

          {events.length === 0 && holidays.length === 0 && (
            <Text className="px-4 py-6 text-center text-sm text-zinc-400">
              {t('calendario.day.empty')}
            </Text>
          )}
        </ScrollView>
      </View>
    </GestureDetector>
  );
}

/* ────────────────────────────── Piezas de UI ──────────────────────────────────────────── */

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

function SubTabChip({
  label,
  on,
  accent,
  onPress,
}: {
  label: string;
  on: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Text className="text-xs text-zinc-500">{label}</Text>
      <Pressable
        onPress={onDec}
        hitSlop={8}
        className="h-6 w-6 items-center justify-center rounded-full border border-zinc-200 active:opacity-60"
      >
        <Text className="text-sm font-bold text-[#0F1B2E]">−</Text>
      </Pressable>
      <Text className="w-10 text-center text-xs font-semibold tabular-nums text-[#0F1B2E]">
        {clockOfHour(value)}
      </Text>
      <Pressable
        onPress={onInc}
        hitSlop={8}
        className="h-6 w-6 items-center justify-center rounded-full border border-zinc-200 active:opacity-60"
      >
        <Text className="text-sm font-bold text-[#0F1B2E]">+</Text>
      </Pressable>
    </View>
  );
}

function OutOfRangeChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="mx-4 my-1 rounded-lg bg-zinc-100 px-3 py-1.5 active:opacity-70">
      <Text className="text-center text-xs font-medium text-zinc-600">{label}</Text>
    </Pressable>
  );
}
