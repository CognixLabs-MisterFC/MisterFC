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
import { BRAND } from '@/theme';
import { familyEventTarget, type FamilyTarget } from '@/notifications/feed-target';

/** Traducción con la firma del hook `useTranslations('')` (namespace raíz). */
type T = (key: string, values?: Record<string, string>) => string;

/** Tipos de evento que son "partido" (llevan rival). */
const MATCH_TYPES = new Set(['match', 'friendly', 'tournament']);

/**
 * Fecha en grande y legible, con nombres del CATÁLOGO (es/en/va): la app nunca usa
 * el idioma del dispositivo, así que no vale `toLocaleDateString(undefined)`.
 * getDay()/getMonth() en hora local, coherente con el resto de la app.
 */
function formatBigDate(t: T, iso: string): string {
  const d = new Date(iso);
  return `${t(`calendario.date.weekday.${d.getDay()}`)} ${d.getDate()} ${t(`calendario.date.month.${d.getMonth()}`)}`;
}

/** Hora HH:MM (formato numérico del dispositivo: respeta 12/24h). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Rival de un partido: del campo `opponent_name` o, si no, del propio título (hoy
 * el título de los partidos ES el rival). Solo para tipos partido; si no hay, null.
 */
function rivalOf(ev: CalendarEvent): string | null {
  if (!MATCH_TYPES.has(ev.type)) return null;
  return ev.opponent_name?.trim() || ev.title?.trim() || null;
}

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
 *
 * Bug 17 — componente COMPARTIDO con el staff (app/staff/calendario.tsx). El
 * destino al tocar una fila se parametriza vía `eventTarget` para que cada área
 * enrute a SUS rutas (familia por defecto = `familyEventTarget`; el staff pasa
 * `staffEventTarget`). Antes estaba cableado a familia y, montado en el staff,
 * empujaba rutas `/family/…` que el AreaGuard rechazaba (rebote al inicio).
 */
export function CalendarioScreen({
  eventTarget = familyEventTarget,
  teamId = null,
}: {
  eventTarget?: (ev: CalendarEvent) => FamilyTarget;
  /**
   * D1b-4 — DIRECCIÓN: acota la agenda a UN equipo explícito. El scope actual
   * (`user_team_ids_in_club`) devuelve VACÍO a un director (no es team_member ni
   * team_staff de ningún equipo) → sin esto, calendario vacío. Con `teamId` se filtra
   * por ese equipo (`filters.teamIds`) y se desactiva el scope por-usuario. DEFAULT
   * `null` → familia y staff IDÉNTICOS: scope por los equipos del usuario, como hoy.
   */
  teamId?: string | null;
} = {}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

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
  }>(
    // D1b-4 — la variante de dirección (teamId) usa un NAMESPACE propio por equipo
    // (`calendar-team:<club>:<team>`) para no contaminar la caché de familia/staff
    // (`calendar`). Familia/staff mantienen su key exacta → comportamiento igual.
    teamId
      ? clubScopedCacheKey('calendar-team', `${clubId ?? 'none'}:${teamId}`)
      : clubScopedCacheKey('calendar', clubId ?? 'none'),
    async (sb) => {
      if (!clubId) return { events: [], holidays: [] };
      // Familia/staff: scope por los equipos del usuario (comportamiento actual).
      // Dirección (teamId): filtra por ESE equipo y desactiva el scope por-usuario
      // (scopeTeamIds omitido) — un director no está en `user_team_ids_in_club`.
      const { events } = await getCalendarDataFromClient(
        sb,
        clubId,
        { startIso: range.startIso, endIso: range.endIso },
        { teamIds: teamId ? [teamId] : [], categoryIds: [], types: [] },
        teamId
          ? {}
          : { scopeTeamIds: await getCalendarScopeTeamIdsFromClient(sb, clubId) },
      );
      const holidays = await getHolidaysFromClient(sb, clubId, range.fromDate, range.toDate);
      return { events, holidays };
    },
  );

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
            <HolidayRow h={item.h} t={t} />
          ) : (
            <EventCard
              ev={item.ev}
              t={t}
              accent={accent}
              onPress={(() => {
                const target = eventTarget(item.ev);
                return target ? () => router.push(target as Href) : undefined;
              })()}
            />
          )
        }
      />
    </View>
  );
}

/**
 * Fila de FESTIVO (badge ámbar). Extraída sin cambio visual de la agenda para que la
 * comparta la vista de MES (18-F1): la lista del día bajo la rejilla pinta el mismo
 * badge que la agenda. `date.slice(5)` = MM-DD (la fecha ya está en su contexto).
 */
export function HolidayRow({ h, t }: { h: HolidayInfo; t: T }) {
  return (
    <View className="mx-4 my-1 rounded-xl bg-amber-50 px-4 py-2">
      <Text className="text-sm font-medium text-amber-800">
        {`${h.date.slice(5)} · ${t('calendario.holidays.badge')} — ${h.reason}`}
      </Text>
    </View>
  );
}

/**
 * Punto 3 QA — Tarjeta de evento legible (mismo lenguaje de tarjetas que el inicio
 * #480 y Entrenamientos #473): TIPO escrito + icono, FECHA en grande, HORA visible,
 * y una línea de detalle con el RIVAL (en partidos, si se conoce) y el EQUIPO. Para
 * los no-partidos conserva el título si aporta algo. Borde izquierdo con el color del
 * equipo (o el acento del club) para distinguir de un vistazo. Compartida con staff.
 * EXPORTADA (18-F1) para reutilizarla en la lista del día de la vista de MES.
 */
export function EventCard({
  ev,
  t,
  accent,
  onPress,
}: {
  ev: CalendarEvent;
  t: T;
  accent: string;
  onPress?: () => void;
}) {
  const cancelled = ev.cancelled_at != null;
  const typeLabel = t(`calendario.types.${ev.type}`);
  const rival = rivalOf(ev);

  // Detalle: rival (partidos) o título (no-partidos, si no repite el tipo), + equipo.
  const detail: string[] = [];
  if (rival) detail.push(`${t('calendario.vs')} ${rival}`);
  else if (!MATCH_TYPES.has(ev.type) && ev.title && ev.title.trim() !== typeLabel) {
    detail.push(ev.title.trim());
  }
  if (ev.team_name) detail.push(ev.team_name);
  const detailLine = detail.join(' · ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="mx-4 my-1.5 rounded-2xl border border-zinc-200 p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: ev.team_color ?? accent }}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-2">
          <Text className="text-xl">{TYPE_ICON[ev.type] ?? '📌'}</Text>
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {typeLabel}
          </Text>
        </View>
        {cancelled ? (
          <View className="rounded-full bg-zinc-100 px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-zinc-500">
              {t('calendario.cancel.badge')}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        className={`mt-1 text-2xl font-extrabold ${cancelled ? 'text-zinc-400 line-through' : 'text-[#0F1B2E]'}`}
      >
        {formatBigDate(t, ev.starts_at)}
      </Text>
      <Text className="text-lg font-bold tabular-nums text-[#0F1B2E]">
        {formatTime(ev.starts_at)}
      </Text>
      {detailLine ? (
        <Text className="mt-1 text-sm text-zinc-600" numberOfLines={2}>
          {detailLine}
        </Text>
      ) : null}
    </Pressable>
  );
}
