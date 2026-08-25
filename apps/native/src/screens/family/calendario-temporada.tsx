import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type TeamOption,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { familyEventTarget, type FamilyTarget } from '@/notifications/feed-target';
import { EventCard, HolidayRow } from '@/screens/family/calendario';
import { reportDataError, reportDataSignal } from '@/lib/report-error';

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
 * 18-F1/F2/F3a — Vista de TEMPORADA. Wrapper con sub-selector MES/DÍA que POSEE el estado
 * de mes/año, el día seleccionado y el FETCH mensual (caché `calendar-month*`). Abre en
 * MES. Tanto MES como DÍA leen del mismo `data` → un único fetch por mes; deslizar a un día
 * de otro mes mueve el mes visible y reaprovecha su caché.
 *
 * Parametrizable para el roll-out (F3b staff / F3c dirección):
 *  · `teamId`    → acota a UN equipo (D1b-4), desactiva el scope por-usuario.
 *  · `clubWide`  → TODOS los eventos del club (dirección), sin scope ni acotar equipo;
 *                  caché en namespace propio (`calendar-month-club`).
 *  · `teamFilter`→ habilita el filtro de equipos multiselección (se muestra solo si el
 *                  scope trae >1 equipo). Familia NO lo pasa → se ve idéntico a hoy.
 *
 * En este PR (F3a) sigue montándose SOLO en familia (sin filtro, sin clubWide).
 */
export function CalendarTemporadaScreen({
  eventTarget = familyEventTarget,
  teamId = null,
  clubWide = false,
  teamFilter = false,
}: {
  eventTarget?: (ev: CalendarEvent) => FamilyTarget;
  teamId?: string | null;
  clubWide?: boolean;
  teamFilter?: boolean;
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
  // Filtro de equipos: null = TODOS (defecto). No persiste (estado de sesión, se reinicia
  // al desmontar la pantalla). Solo activo si `teamFilter` y hay >1 equipo en el scope.
  const [selectedTeams, setSelectedTeams] = useState<Set<string> | null>(null);

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

  const cacheKey = clubWide
    ? clubScopedCacheKey('calendar-month-club', `${clubId ?? 'none'}:${monthTag}`)
    : teamId
      ? clubScopedCacheKey('calendar-month-team', `${clubId ?? 'none'}:${teamId}:${monthTag}`)
      : clubScopedCacheKey('calendar-month', `${clubId ?? 'none'}:${monthTag}`);

  const { data, fromCache, loading } = useCached<{
    events: CalendarEvent[];
    holidays: HolidayInfo[];
    teams: TeamOption[];
  }>(cacheKey, async (sb) => {
    if (!clubId) return { events: [], holidays: [], teams: [] };
    // scope por-usuario solo en familia/staff (ni teamId ni clubWide).
    const scopeTeamIds =
      teamId || clubWide ? null : await getCalendarScopeTeamIdsFromClient(sb, clubId);
    const { events, teams } = await getCalendarDataFromClient(
      sb,
      clubId,
      { startIso: range.startIso, endIso: range.endIso },
      { teamIds: teamId ? [teamId] : [], categoryIds: [], types: [] },
      teamId || clubWide
        ? { onError: reportDataError }
        : { scopeTeamIds, onError: reportDataError },
    );
    // INSTRUMENTACIÓN (patrón #488) — señal del fetch FRESCO de la temporada: cuántos
    // eventos trae la consulta VIVA, la ventana usada y el SCOPE que se pasó (modo y nº de
    // teamIds), para distinguir "consulta vacía" de "llega y no se pinta". Solo corre en
    // fetch fresco (readThrough no ejecuta el fetcher al servir caché). Sin PII: escalares.
    reportDataSignal('temporada-month', {
      phase: 'fetch',
      count: events.length,
      first: events[0]?.starts_at ?? 'none',
      from: range.fromDate,
      to: range.toDate,
      mode: clubWide ? 'clubWide' : teamId ? 'team' : 'user',
      scope_team_ids: clubWide || teamId ? -1 : (scopeTeamIds?.length ?? -1),
      filter: teamFilter,
    });
    const holidays = await getHolidaysFromClient(sb, clubId, range.fromDate, range.toDate);
    // Equipos EN EL SCOPE (fuente del filtro): club-wide → todos; teamId → ese; familia/
    // staff → los del scope por-usuario. `teams` del loader ya son de la temporada activa.
    const scopedTeams = teamId
      ? teams.filter((tm) => tm.id === teamId)
      : !clubWide && scopeTeamIds
        ? teams.filter((tm) => scopeTeamIds.includes(tm.id))
        : teams;
    return { events, holidays, teams: scopedTeams };
  });

  const teamsInScope = data?.teams ?? [];
  const showFilter = teamFilter && teamsInScope.length > 1;

  const isTeamSelected = useCallback(
    (id: string) => selectedTeams === null || selectedTeams.has(id),
    [selectedTeams],
  );

  // Eventos tras el filtro de equipos. Los de club (team_id null) NO se filtran (no son de
  // un equipo). Con el filtro apagado o en "todos" (null) no se filtra nada.
  const filteredEvents = useMemo(() => {
    const evs = data?.events ?? [];
    if (!showFilter || selectedTeams === null) return evs;
    return evs.filter((e) => e.team_id === null || selectedTeams.has(e.team_id));
  }, [data, showFilter, selectedTeams]);

  // INSTRUMENTACIÓN (patrón #488) — señal del valor SERVIDO a la rejilla (cada vez que
  // cambia `data`: primero la caché, luego la revalidación). `count_raw` = eventos del
  // fetch; `count_grid` = tras el filtro de equipos → si `raw>0` y `grid=0` el filtro se
  // come todo; si ambos 0 la consulta vino vacía. `from_cache=true` solo OFFLINE. Sin PII.
  useEffect(() => {
    if (loading || !data) return;
    reportDataSignal('temporada-month', {
      phase: 'render',
      count_raw: data.events.length,
      count_grid: filteredEvents.length,
      month: monthTag,
      show_filter: showFilter,
      teams_in_scope: data.teams.length,
      from_cache: fromCache,
    });
  }, [loading, data, filteredEvents, monthTag, showFilter, fromCache]);

  // Índices por día: qué días tienen evento / son festivo, y el detalle del día tocado.
  const { eventDays, holidayDays, dayEvents, dayHolidays } = useMemo(() => {
    const evByDay = new Map<string, CalendarEvent[]>();
    for (const ev of filteredEvents) {
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
  }, [filteredEvents, data, selectedDay]);

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

  const toggleTeam = (id: string) => {
    setSelectedTeams((prev) => {
      const base = prev ?? new Set(teamsInScope.map((tm) => tm.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

      {/* Filtro de equipos (multiselección, cliente). Solo si procede. Aplica a MES y DÍA. */}
      {showFilter && (
        <TeamFilterBar
          teams={teamsInScope}
          accent={accent}
          t={t}
          isSelected={isTeamSelected}
          onToggle={toggleTeam}
          onAll={() => setSelectedTeams(null)}
          onNone={() => setSelectedTeams(new Set())}
        />
      )}

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
          // — decisión de Jose: nadie se lleva un 16-22 al día siguiente y se pierde el
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

/* ────────────────────────────── Vista DÍA (18-F2/F3a) ─────────────────────────────────── */

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

/** Pill de duración: "3 h" / "30 min" / "1 h 30 min". */
const formatDuration = (mins: number, t: T): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const H = t('calendario.day.dur.h');
  const M = t('calendario.day.dur.min');
  if (h === 0) return `${m} ${M}`;
  if (m === 0) return `${h} ${H}`;
  return `${h} ${H} ${m} ${M}`;
};

type DayItem = {
  ev: CalendarEvent;
  startMin: number;
  durMin: number | null; // null si no hay ends_at válido → la duración no se conoce
};

/**
 * 18-F3a — Vista DÍA con APILADO VERTICAL. Timeline por horas; los eventos se colocan como
 * filas a ANCHO COMPLETO bajo la hora en la que EMPIEZAN. Cuando varios coinciden en la
 * misma hora se apilan (la banda crece por recuento, SIN tope, sin repartir el ancho en
 * columnas). La duración es TEXTO (rango + pill), no altura: un evento largo vive solo en
 * su banda de inicio y deja las horas siguientes aparentemente libres (consecuencia
 * aceptada; el rango en texto ya lo dice). Sustituye el reparto en carriles de F2.
 */
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

  // Eventos con hora, con su minuto de inicio y duración (para el rango de texto y el pill).
  const timed: DayItem[] = useMemo(() => {
    return events
      .filter((e) => !e.all_day)
      .map((ev) => {
        const startMin = minutesOf(ev.starts_at);
        let durMin: number | null = null;
        if (ev.ends_at) {
          const diff =
            (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000;
          if (diff > 0) durMin = Math.round(diff);
        }
        return { ev, startMin, durMin };
      })
      .sort((a, b) => a.startMin - b.startMin);
  }, [events]);

  const rangeStartMin = rangeStart * 60;
  const rangeEndMin = rangeEnd * 60;

  // Fuera de rango: los eventos se COLOCAN por su hora de inicio → fuera = empieza fuera.
  const before = timed.filter((x) => x.startMin < rangeStartMin).length;
  const after = timed.filter((x) => x.startMin >= rangeEndMin).length;

  const resetRange = () => {
    setRangeStart(DEFAULT_START);
    setRangeEnd(DEFAULT_END);
  };

  // Deslizar entre días: pan horizontal. `failOffsetY` cede el gesto al scroll vertical;
  // `activeOffsetX` exige movimiento horizontal para activarse.
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

  // Bandas por hora: cada hora del rango con los eventos que EMPIEZAN en ella.
  const hours: { h: number; items: DayItem[] }[] = [];
  for (let h = rangeStart; h < rangeEnd; h++) {
    hours.push({
      h,
      items: timed.filter((x) => x.startMin >= h * 60 && x.startMin < (h + 1) * 60),
    });
  }

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

        {/* Aviso de eventos que empiezan por encima del rango visible. */}
        {before > 0 && (
          <OutOfRangeChip
            label={t('calendario.day.before_range', { count: String(before) })}
            onPress={resetRange}
          />
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {hours.map(({ h, items }) => (
            <View key={h} className="flex-row border-t border-zinc-100 px-2">
              <Text style={{ width: GUTTER }} className="py-1 text-[10px] text-zinc-400">
                {clockOfHour(h)}
              </Text>
              <View className="flex-1 py-0.5">
                {items.map((it) => {
                  const ev = it.ev;
                  const timeText =
                    it.durMin != null
                      ? `${clockOfIso(ev.starts_at)}–${clockOfIso(ev.ends_at as string)}`
                      : clockOfIso(ev.starts_at);
                  const rival =
                    ev.type === 'match' || ev.type === 'friendly' || ev.type === 'tournament'
                      ? ev.opponent_name?.trim() || ev.title?.trim() || null
                      : null;
                  const detail = rival ?? ev.team_name ?? t(`calendario.types.${ev.type}`);
                  return (
                    <Pressable
                      key={`e:${ev.id}`}
                      onPress={() => onOpenEvent(ev)}
                      className="my-0.5 rounded-lg px-2 py-1.5 active:opacity-70"
                      style={{
                        backgroundColor: `${ev.team_color ?? accent}22`,
                        borderLeftWidth: 3,
                        borderLeftColor: ev.team_color ?? accent,
                      }}
                    >
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-xs font-semibold text-[#0F1B2E]">
                          {`${TYPE_ICON[ev.type] ?? '📌'} ${timeText}`}
                        </Text>
                        {it.durMin != null && (
                          <View className="rounded-full bg-white/70 px-1.5">
                            <Text className="text-[10px] font-medium text-zinc-500">
                              {formatDuration(it.durMin, t)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-[11px] text-zinc-600" numberOfLines={1}>
                        {detail}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Aviso de eventos que empiezan por debajo del rango visible. */}
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

/**
 * 18-F3a — Filtro de equipos (multiselección, en CLIENTE). Chips por equipo con atajos
 * "todos"/"vaciar". El estado vive en el wrapper; aquí solo se pinta. Se muestra únicamente
 * cuando hay >1 equipo en el scope (con uno solo no aparece).
 */
function TeamFilterBar({
  teams,
  accent,
  t,
  isSelected,
  onToggle,
  onAll,
  onNone,
}: {
  teams: TeamOption[];
  accent: string;
  t: T;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <View className="border-b border-zinc-100 pb-1.5">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-0.5">
        <Text className="text-[11px] font-semibold uppercase text-zinc-400">
          {t('calendario.season.filter.label')}
        </Text>
        <View className="flex-row gap-3">
          <Pressable onPress={onAll} hitSlop={6} className="active:opacity-60">
            <Text className="text-xs font-semibold" style={{ color: accent }}>
              {t('calendario.season.filter.all')}
            </Text>
          </Pressable>
          <Pressable onPress={onNone} hitSlop={6} className="active:opacity-60">
            <Text className="text-xs font-semibold text-zinc-400">
              {t('calendario.season.filter.none')}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {teams.map((tm) => {
          const on = isSelected(tm.id);
          return (
            <Pressable
              key={tm.id}
              onPress={() => onToggle(tm.id)}
              className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
              style={on ? { backgroundColor: tm.color || accent } : undefined}
            >
              <Text
                className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}
              >
                {tm.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
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
    <Pressable
      onPress={onPress}
      className="mx-4 my-1 rounded-lg bg-zinc-100 px-3 py-1.5 active:opacity-70"
    >
      <Text className="text-center text-xs font-medium text-zinc-600">{label}</Text>
    </Pressable>
  );
}
