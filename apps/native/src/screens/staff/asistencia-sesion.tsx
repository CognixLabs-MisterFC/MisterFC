import { useCallback, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  ATTENDANCE_PRIMARY_CHIPS,
  ATTENDANCE_SECONDARY_CHIPS,
  clearAttendanceFromClient,
  eventScopedCacheKey,
  getEventAttendanceFromClient,
  markAttendanceFromClient,
  otherChipLabel,
  type AttendanceCode,
  type AttendanceRosterPlayer,
  type AttendanceRecord,
  type EventAttendanceData,
  type Role,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-7a — Pasar lista de UNA sesión (staff). Roster + estado actual; cada marca es
 * INCREMENTAL (un upsert por jugador vía core `markAttendanceFromClient`) detrás del
 * WRITE-GUARD: sin red no se marca (aviso "sin conexión"), y la UI refleja lo
 * GUARDADO (refresca tras cada marca, sin estado optimista). El GATE de quién puede
 * pasar lista es server-side (`canRecord`/RLS); si no puede, los chips van
 * deshabilitados y un rechazo se maneja con gracia (sin crash). El EQUIPO lo fija la
 * sesión. Caché event-scoped (eventId en la key); el Map de core se serializa a
 * Record para poder cachearlo offline.
 */

/** DTO serializable para la caché (JSON no soporta Map). */
type AttendanceView = {
  event: EventAttendanceData['event'];
  roster: AttendanceRosterPlayer[];
  attendance: Record<string, AttendanceRecord>;
  canRecord: boolean;
  isFuture: boolean;
};

export function AsistenciaSesionScreen({ eventId }: { eventId: string | null }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { user } = useSession();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const role = (activeClub?.role ?? null) as Role | null;
  const userId = user?.id ?? null;
  const accent = theme?.color ?? '#0F1B2E';

  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [othersFor, setOthersFor] = useState<string | null>(null);

  const { data, fromCache, loading, refresh } = useCached<AttendanceView | null>(
    eventScopedCacheKey('asistencia-sesion', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId || !role) return null;
      const d = await getEventAttendanceFromClient(sb, {
        clubId,
        role,
        userId,
        eventId,
      });
      if (!d) return null;
      return {
        event: d.event,
        roster: d.roster,
        attendance: Object.fromEntries(d.attendance),
        canRecord: d.canRecord,
        isFuture: d.isFuture,
      };
    },
  );

  const canWrite = !!data?.canRecord && online && !data?.isFuture;

  const onMark = useCallback(
    async (playerId: string, code: AttendanceCode) => {
      if (!eventId || !canWrite || busy) return; // write-guard + gate (cliente)
      setBusy(playerId);
      setErrorKey(null);
      const res = await markAttendanceFromClient(supabase, {
        event_id: eventId,
        player_id: playerId,
        code,
      });
      setBusy(null);
      if (res.ok) refresh();
      else
        setErrorKey(
          res.error === 'forbidden'
            ? 'asistencia_staff.forbidden'
            : 'asistencia_staff.error',
        );
    },
    [eventId, canWrite, busy, refresh],
  );

  const onClear = useCallback(
    async (playerId: string) => {
      if (!eventId || !canWrite || busy) return;
      setBusy(playerId);
      setErrorKey(null);
      const res = await clearAttendanceFromClient(supabase, eventId, playerId);
      setBusy(null);
      if (res.ok) refresh();
      else
        setErrorKey(
          res.error === 'forbidden'
            ? 'asistencia_staff.forbidden'
            : 'asistencia_staff.error',
        );
    },
    [eventId, canWrite, busy, refresh],
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('asistencia_staff.not_found')} />;

  const roster = data.roster;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-xl font-semibold text-[#0F1B2E]">
          {data.event.team_name}
        </Text>
        <Text className="text-xs text-zinc-400" numberOfLines={1}>
          {[
            new Date(data.event.starts_at).toLocaleString(),
            data.event.category_name,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      {/* Aviso: sin permiso (gate server-side) o sin conexión (write-guard). */}
      {!data.canRecord ? (
        <Banner text={t('asistencia_staff.no_permission')} />
      ) : !online ? (
        <Banner text={t('asistencia_staff.offline_write')} />
      ) : null}
      {errorKey ? (
        <View className="bg-red-50 px-4 py-2">
          <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
        </View>
      ) : null}

      {roster.length === 0 ? (
        <EmptyState message={t('asistencia_staff.roster_empty')} />
      ) : (
        <FlatList
          data={roster}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const current = data.attendance[item.id]?.code ?? null;
            const isBusy = busy === item.id;
            const othersLabel = otherChipLabel(current);
            return (
              <View className="mx-4 my-1 rounded-xl border border-zinc-200 px-3 py-2">
                <View className="flex-row items-center gap-2">
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-zinc-100">
                    <Text className="text-[11px] font-semibold text-zinc-600">
                      {item.dorsal ?? '—'}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-sm font-medium text-[#0F1B2E]"
                      numberOfLines={1}
                    >
                      {[item.first_name, item.last_name]
                        .filter(Boolean)
                        .join(' ')}
                    </Text>
                    {item.is_promoted ? (
                      <Text className="text-[10px] text-amber-600" numberOfLines={1}>
                        {t('asistencia_staff.promoted')}
                        {item.from_team_name ? ` · ${item.from_team_name}` : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {ATTENDANCE_PRIMARY_CHIPS.map((code) => {
                    const on = current === code;
                    return (
                      <Chip
                        key={code}
                        label={t(`attendance_code.${code}`)}
                        on={on}
                        accent={accent}
                        disabled={!canWrite || isBusy}
                        onPress={() => onMark(item.id, code)}
                      />
                    );
                  })}
                  <Chip
                    label={
                      othersLabel
                        ? t(`attendance_code.${othersLabel}`)
                        : t('asistencia_staff.others')
                    }
                    on={othersLabel != null}
                    accent={accent}
                    disabled={!canWrite || isBusy}
                    onPress={() => setOthersFor(item.id)}
                  />
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Modal "Otros": códigos secundarios + quitar marca. */}
      <OthersModal
        visible={othersFor != null}
        accent={accent}
        onPick={(code) => {
          const pid = othersFor;
          setOthersFor(null);
          if (pid) onMark(pid, code);
        }}
        onClear={() => {
          const pid = othersFor;
          setOthersFor(null);
          if (pid) onClear(pid);
        }}
        onClose={() => setOthersFor(null)}
      />
    </View>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="bg-zinc-100 px-4 py-2">
      <Text className="text-center text-xs text-zinc-500">{text}</Text>
    </View>
  );
}

function Chip({
  label,
  on,
  accent,
  disabled,
  onPress,
}: {
  label: string;
  on: boolean;
  accent: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 active:opacity-70 ${on ? '' : 'border border-zinc-200'}`}
      style={{
        backgroundColor: on ? accent : undefined,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        className={
          on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-600'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OthersModal({
  visible,
  accent,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  accent: string;
  onPick: (code: AttendanceCode) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50 px-6"
        onPress={onClose}
      >
        <Pressable className="w-full max-w-md rounded-2xl bg-white p-4">
          <Text className="mb-2 text-sm font-semibold text-[#0F1B2E]">
            {t('asistencia_staff.others')}
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {ATTENDANCE_SECONDARY_CHIPS.map((code) => (
              <Pressable
                key={code}
                onPress={() => onPick(code)}
                className="rounded-lg px-3 py-2.5 active:opacity-60"
              >
                <Text className="text-sm text-[#0F1B2E]">
                  {t(`attendance_code.${code}`)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={onClear}
              className="mt-1 rounded-lg border border-red-200 px-3 py-2.5 active:opacity-60"
            >
              <Text className="text-sm font-medium text-red-600">
                {t('asistencia_staff.clear')}
              </Text>
            </Pressable>
          </ScrollView>
          <Pressable
            onPress={onClose}
            className="mt-3 self-end rounded-full px-4 py-2 active:opacity-60"
            style={{ backgroundColor: accent }}
          >
            <Text className="text-sm font-semibold text-white">OK</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
