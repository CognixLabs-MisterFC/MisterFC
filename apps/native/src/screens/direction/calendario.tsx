import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  getHolidaysFromClient,
  getPendingHolidayApprovalsFromClient,
  clubScopedCacheKey,
  type HolidayInfo,
  type PendingApprovalItem,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type CalData = { holidays: HolidayInfo[]; pending: PendingApprovalItem[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O2-11c-1 — CALENDARIO de DIRECCIÓN: acciones de festivos (solo lectura sin red).
 * Marcar/desmarcar festivo + aprobar/rechazar entreno en festivo. Cada acción con
 * SERVICE-ROLE (fan-out) va por route handler bearer (`callServerEndpoint`): el gate
 * admin/director vive en la RPC del servidor; la UI solo exige red (write-guard).
 * Caché club-scoped; refresca tras cada acción. AreaGuard('direction').
 */
export function DireccionCalendarioScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<CalData>(
    clubScopedCacheKey('dir-calendario', clubId ?? 'none'),
    async (sb) => {
      if (!clubId) return { holidays: [], pending: [] };
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
      const end = new Date(now.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
      const [holidays, pending] = await Promise.all([
        getHolidaysFromClient(sb, clubId, start, end),
        getPendingHolidayApprovalsFromClient(sb, clubId),
      ]);
      return { holidays, pending };
    },
  );

  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canMark = online && !busy && DATE_RE.test(date.trim()) && reason.trim().length > 0;

  const post = async (path: string, body: unknown): Promise<boolean> => {
    try {
      const r = await callServerEndpoint(path, { body });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        Alert.alert(t('dir_cal.error'), j.error ?? String(r.status));
        return false;
      }
      return true;
    } catch {
      Alert.alert(t('dir_cal.error'), t('dir_cal.offline'));
      return false;
    }
  };

  const doMark = async () => {
    if (!canMark || !clubId) return;
    setBusy(true);
    const ok = await post('/api/holidays/mark', { clubId, date: date.trim(), reason: reason.trim() });
    setBusy(false);
    if (ok) {
      setDate('');
      setReason('');
      refresh();
    }
  };

  const doUnmark = async (holidayId: string) => {
    if (!online || busy) return;
    setBusy(true);
    const ok = await post('/api/holidays/unmark', { holidayId });
    setBusy(false);
    if (ok) refresh();
  };

  const doDecide = async (eventId: string, approve: boolean, rej: string | null) => {
    if (!online || busy) return;
    setBusy(true);
    const ok = await post('/api/events/decide', { eventId, approve, reason: rej });
    setBusy(false);
    if (ok) {
      setRejectingId(null);
      setRejectReason('');
      refresh();
    }
  };

  if (loading) return <LoadingScreen />;
  const d = data ?? { holidays: [], pending: [] };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <ScreenTitle>{t('dir_cal.title')}</ScreenTitle>

        {/* Marcar festivo */}
        <Section title={t('calendario.holidays.trigger')}>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder={t('dir_cal.date_ph')}
            placeholderTextColor="#a1a1aa"
            autoCapitalize="none"
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
          />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t('calendario.holidays.reason_label')}
            placeholderTextColor="#a1a1aa"
            className="mt-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
          />
          <ActionBtn label={t('calendario.holidays.confirm')} onPress={doMark} disabled={!canMark} accent={accent} />
          {!online ? <Text className="mt-1 text-xs text-zinc-400">{t('dir_cal.offline')}</Text> : null}
        </Section>

        {/* Festivos marcados */}
        <Section title={t('dir_cal.holidays_title')}>
          {d.holidays.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dir_cal.no_holidays')}</Text>
          ) : (
            d.holidays.map((h) => (
              <View key={h.id} className="flex-row items-center gap-2 border-b border-zinc-50 py-2">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-[#0F1B2E]">{h.date}</Text>
                  {h.reason ? <Text className="text-xs text-zinc-400">{h.reason}</Text> : null}
                </View>
                <Pressable
                  disabled={!online || busy}
                  onPress={() => doUnmark(h.id)}
                  className={`rounded-lg border border-zinc-200 px-3 py-1 ${!online || busy ? 'opacity-40' : 'active:opacity-70'}`}
                >
                  <Text className="text-xs font-semibold text-zinc-600">{t('dir_cal.unmark')}</Text>
                </Pressable>
              </View>
            ))
          )}
        </Section>

        {/* Entrenos en festivo pendientes de aprobar */}
        <Section title={t('dir_cal.pending_title')}>
          {d.pending.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dir_cal.no_pending')}</Text>
          ) : (
            d.pending.map((p) => (
              <View key={p.eventId} className="border-b border-zinc-50 py-2">
                <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                  {p.title}
                </Text>
                <Text className="text-xs text-zinc-400">
                  {(p.teamName ?? '—') + ' · ' + new Date(p.startsAt).toLocaleString()}
                </Text>
                {rejectingId === p.eventId ? (
                  <View className="mt-2 gap-2">
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder={t('calendario.approval.reason_label')}
                      placeholderTextColor="#a1a1aa"
                      className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                    />
                    <View className="flex-row gap-2">
                      <SmallBtn
                        label={t('dir_cal.confirm')}
                        onPress={() => doDecide(p.eventId, false, rejectReason.trim() || null)}
                        disabled={!online || busy || rejectReason.trim().length === 0}
                        tone="danger"
                      />
                      <SmallBtn
                        label={t('calendario.dialog.cancel')}
                        onPress={() => {
                          setRejectingId(null);
                          setRejectReason('');
                        }}
                        disabled={busy}
                        tone="neutral"
                      />
                    </View>
                  </View>
                ) : (
                  <View className="mt-2 flex-row gap-2">
                    <SmallBtn
                      label={t('calendario.approval.approve')}
                      onPress={() => doDecide(p.eventId, true, null)}
                      disabled={!online || busy}
                      tone="accent"
                      accent={accent}
                    />
                    <SmallBtn
                      label={t('calendario.approval.reject')}
                      onPress={() => {
                        setRejectingId(p.eventId);
                        setRejectReason('');
                      }}
                      disabled={!online || busy}
                      tone="neutral"
                    />
                  </View>
                )}
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}

function ActionBtn({
  label,
  onPress,
  disabled,
  accent,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  accent: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`mt-3 items-center rounded-xl py-2.5 ${disabled ? 'opacity-40' : 'active:opacity-80'}`}
      style={{ backgroundColor: accent }}
    >
      <Text className="text-sm font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

function SmallBtn({
  label,
  onPress,
  disabled,
  tone,
  accent,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone: 'accent' | 'danger' | 'neutral';
  accent?: string;
}) {
  const style =
    tone === 'accent'
      ? { backgroundColor: accent }
      : tone === 'danger'
        ? { backgroundColor: '#dc2626' }
        : undefined;
  const textCls = tone === 'neutral' ? 'text-zinc-600' : 'text-white';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-lg px-4 py-1.5 ${tone === 'neutral' ? 'border border-zinc-200' : ''} ${disabled ? 'opacity-40' : 'active:opacity-70'}`}
      style={style}
    >
      <Text className={`text-xs font-semibold ${textCls}`}>{label}</Text>
    </Pressable>
  );
}
