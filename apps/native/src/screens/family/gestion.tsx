import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import {
  clearPlayerPhotoFromClient,
  getPlayerManagementAccessFromClient,
  getPlayerMedicalFromClient,
  getPlayerPhotoPathFromClient,
  playerScopedCacheKey,
  playerPhotoUploadSchema,
  requestPlayerErasureFromClient,
  setPlayerMedicalFromClient,
  setPlayerPhotoPathFromClient,
  type PlayerManagementAccess,
  type PlayerMedical,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { MIME_TO_EXT, base64ToBytes } from '@/lib/image-upload';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { ChildSelector } from '@/ui/child-selector';
import { PlayerAvatar } from '@/ui/player-avatar';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { appLocale } from '@/i18n';
import { useTranslations } from '@/locale/provider';
import { downloadServerFile } from '@/lib/server-api';
import { BRAND } from '@/theme';

/**
 * O2-5 C2 — GESTIÓN SENSIBLE del HIJO ACTIVO (la pieza más delicada de Familia):
 * foto (Storage privado, cara de un MENOR), datos médicos (cerrados por RPC +
 * consentimiento) y derecho al olvido (SOLICITUD irreversible). Todas las escrituras
 * pasan por RPC SECURITY DEFINER de core; el write-guard bloquea sin conexión.
 *
 * La FOTO no se cachea (se firma online, ver PlayerAvatar). La MÉDICA sí se cachea
 * (secure-store cifrado, player-scoped). El EXPEDIENTE PDF es server-only (route
 * handler con sesión cookie + auditoría): aquí queda DESHABILITADO ("próximamente").
 */

export function GestionScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const access = useCached<PlayerManagementAccess | null>(
    playerScopedCacheKey('mgmt', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerManagementAccessFromClient(sb, playerId) : Promise.resolve(null)),
  );
  const medical = useCached<PlayerMedical | null>(
    playerScopedCacheKey('medical', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerMedicalFromClient(sb, playerId) : Promise.resolve(null)),
  );
  const photo = useCached<string | null>(
    playerScopedCacheKey('photo-path', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerPhotoPathFromClient(sb, playerId) : Promise.resolve(null)),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (access.loading) return <LoadingScreen />;

  const isTutor = access.data?.isTutor ?? false;
  const canWriteMedical = access.data?.canWriteMedical ?? false;
  const fromCache = access.fromCache || medical.fromCache || photo.fromCache;
  const initials = (activePlayer?.name ?? '').trim().slice(0, 2);

  if (!isTutor) {
    return (
      <View className="flex-1 bg-white">
        <ChildSelector />
        <EmptyState message={t('gestion.not_tutor')} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <ChildSelector />
      <OfflineBanner show={fromCache} />
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('gestion.offline_write')}</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <PhotoCard
          playerId={playerId}
          accent={accent}
          initials={initials}
          path={photo.data ?? null}
          online={online}
          onChanged={photo.refresh}
        />
        <MedicalCard
          key={playerId}
          playerId={playerId}
          initial={medical.data ?? null}
          canWrite={canWriteMedical}
          online={online}
          loading={medical.loading}
        />
        <ExportCard playerId={playerId} online={online} />
        <ErasureCard playerId={playerId} online={online} />
      </ScrollView>
    </View>
  );
}

// ── Foto ────────────────────────────────────────────────────────────────────
function PhotoCard({
  playerId,
  accent,
  initials,
  path,
  online,
  onChanged,
}: {
  playerId: string;
  accent: string;
  initials: string;
  path: string | null;
  online: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    if (!online || busy) return;
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(t('gestion.photo_permission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const mime = asset.mimeType ?? 'image/jpeg';
    const size = asset.fileSize ?? (asset.base64 ? Math.floor((asset.base64.length * 3) / 4) : 0);
    const validation = playerPhotoUploadSchema.safeParse({ mimeType: mime, size });
    if (!validation.success) {
      const code = validation.error.issues[0]?.message ?? '';
      setError(code.includes('large') ? t('gestion.photo_err_large') : t('gestion.photo_err_mime'));
      return;
    }
    if (!asset.base64) {
      setError(t('gestion.photo_err_generic'));
      return;
    }

    setBusy(true);
    const ext = MIME_TO_EXT[mime] ?? 'jpg';
    const objectPath = `${playerId}/${Date.now()}-${Math.floor(Math.random() * 1e9)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('player-photos')
      .upload(objectPath, base64ToBytes(asset.base64), {
        contentType: mime,
        upsert: false,
      });
    if (uploadError) {
      setBusy(false);
      setError(t('gestion.photo_err_generic'));
      return;
    }
    const res = await setPlayerPhotoPathFromClient(supabase, playerId, objectPath);
    setBusy(false);
    if ('ok' in res) onChanged();
    else setError(t('gestion.photo_err_generic'));
  }

  async function remove() {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    const res = await clearPlayerPhotoFromClient(supabase, playerId);
    setBusy(false);
    if ('ok' in res) onChanged();
    else setError(t('gestion.photo_err_generic'));
  }

  return (
    <Card title={t('gestion.photo_title')}>
      <View className="flex-row items-center gap-4">
        <PlayerAvatar path={path} initials={initials} accent={accent} size={72} />
        <View className="flex-1 gap-2">
          <View className="flex-row flex-wrap gap-2">
            <ActionButton
              label={t('gestion.photo_change')}
              onPress={pick}
              disabled={!online || busy}
              busy={busy}
            />
            {path ? (
              <ActionButton
                label={t('gestion.photo_remove')}
                onPress={remove}
                disabled={!online || busy}
                variant="ghost"
              />
            ) : null}
          </View>
          <Text className="text-xs text-zinc-400">{t('gestion.photo_hint')}</Text>
          {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

// ── Datos médicos ─────────────────────────────────────────────────────────────
function MedicalCard({
  playerId,
  initial,
  canWrite,
  online,
  loading,
}: {
  playerId: string;
  initial: PlayerMedical | null;
  canWrite: boolean;
  online: boolean;
  loading: boolean;
}) {
  const t = useTranslations('');
  const [allergies, setAllergies] = useState(initial?.allergies ?? '');
  const [medication, setMedication] = useState(initial?.medication ?? '');
  const [conditions, setConditions] = useState(initial?.medical_conditions ?? '');
  const [emergency, setEmergency] = useState(initial?.emergency_contact ?? '');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error' | 'forbidden'>('idle');

  async function save() {
    if (!online || busy) return;
    setBusy(true);
    setState('idle');
    const res = await setPlayerMedicalFromClient(supabase, playerId, {
      allergies,
      medication,
      medical_conditions: conditions,
      emergency_contact: emergency,
    });
    setBusy(false);
    if ('ok' in res) setState('saved');
    else setState(res.error === 'forbidden' ? 'forbidden' : 'error');
  }

  if (loading) {
    return (
      <Card title={t('gestion.medical_title')}>
        <ActivityIndicator color={BRAND.navy} />
      </Card>
    );
  }

  // Sin consentimiento de escritura → SOLO LECTURA (o aviso si no hay dato).
  if (!canWrite) {
    const hasAny = initial?.allergies || initial?.medication || initial?.medical_conditions || initial?.emergency_contact;
    return (
      <Card title={t('gestion.medical_title')}>
        <Text className="mb-2 text-xs text-zinc-400">{t('gestion.medical_no_write')}</Text>
        {hasAny ? (
          <View className="gap-2">
            <ReadRow label={t('gestion.medical_allergies')} value={initial?.allergies} />
            <ReadRow label={t('gestion.medical_medication')} value={initial?.medication} />
            <ReadRow label={t('gestion.medical_conditions')} value={initial?.medical_conditions} />
            <ReadRow label={t('gestion.medical_emergency')} value={initial?.emergency_contact} />
          </View>
        ) : (
          <Text className="text-sm text-zinc-500">{t('gestion.medical_empty')}</Text>
        )}
      </Card>
    );
  }

  return (
    <Card title={t('gestion.medical_title')}>
      <Text className="mb-2 text-xs text-zinc-400">{t('gestion.medical_tutor_hint')}</Text>
      <Field label={t('gestion.medical_allergies')} value={allergies} onChange={setAllergies} />
      <Field label={t('gestion.medical_medication')} value={medication} onChange={setMedication} />
      <Field label={t('gestion.medical_conditions')} value={conditions} onChange={setConditions} multiline />
      <Field label={t('gestion.medical_emergency')} value={emergency} onChange={setEmergency} />
      <ActionButton
        label={t('gestion.medical_save')}
        onPress={save}
        disabled={!online || busy}
        busy={busy}
      />
      {state === 'saved' ? (
        <Text className="mt-2 text-xs text-emerald-600">{t('gestion.medical_saved')}</Text>
      ) : null}
      {state === 'forbidden' ? (
        <Text className="mt-2 text-xs text-red-600">{t('gestion.medical_forbidden')}</Text>
      ) : null}
      {state === 'error' ? (
        <Text className="mt-2 text-xs text-red-600">{t('gestion.medical_err')}</Text>
      ) : null}
    </Card>
  );
}

// ── Expediente PDF (O2-5 F1: route handler de Next con bearer + auditoría) ─────
function ExportCard({ playerId, online }: { playerId: string; online: boolean }) {
  const t = useTranslations('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'error' | 'unavailable'>('idle');

  async function download() {
    if (!online || busy) return; // write-guard
    setBusy(true);
    setState('idle');
    try {
      const uri = await downloadServerFile(
        `/${appLocale()}/mi-ficha/export/${playerId}`,
        'expediente.pdf',
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('gestion.export_title'),
        });
      }
    } catch (e) {
      setState((e as Error)?.message === 'no_web_url' ? 'unavailable' : 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('gestion.export_title')}>
      <Text className="mb-3 text-xs text-zinc-400">{t('gestion.export_hint')}</Text>
      <ActionButton
        label={t('gestion.export_download')}
        onPress={download}
        disabled={!online || busy}
        busy={busy}
      />
      {!online ? (
        <Text className="mt-2 text-xs text-amber-600">{t('gestion.export_offline')}</Text>
      ) : null}
      {state === 'error' ? (
        <Text className="mt-2 text-xs text-red-600">{t('gestion.export_error')}</Text>
      ) : null}
      {state === 'unavailable' ? (
        <Text className="mt-2 text-xs text-red-600">{t('gestion.export_unavailable')}</Text>
      ) : null}
    </Card>
  );
}

// ── Derecho al olvido (SOLICITUD, doble confirmación) ─────────────────────────
function ErasureCard({ playerId, online }: { playerId: string; online: boolean }) {
  const t = useTranslations('');
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');

  async function confirm() {
    if (!online || busy || !ack) return;
    setBusy(true);
    const res = await requestPlayerErasureFromClient(supabase, playerId, reason);
    setBusy(false);
    if ('ok' in res) {
      setOpen(false);
      setState('sent');
    } else {
      setState('error');
    }
  }

  function close() {
    setOpen(false);
    setAck(false);
  }

  if (state === 'sent') {
    return (
      <Card title={t('gestion.erasure_title')}>
        <Text className="text-sm text-emerald-600">{t('gestion.erasure_sent')}</Text>
      </Card>
    );
  }

  return (
    <Card title={t('gestion.erasure_title')}>
      <Text className="mb-3 text-xs text-zinc-400">{t('gestion.erasure_hint')}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!online}
        className="self-start rounded-full border border-red-300 px-4 py-2 active:opacity-60"
        style={!online ? { opacity: 0.5 } : undefined}
      >
        <Text className="text-sm font-medium text-red-600">{t('gestion.erasure_button')}</Text>
      </Pressable>
      {state === 'error' ? (
        <Text className="mt-2 text-xs text-red-600">{t('gestion.erasure_err')}</Text>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full max-w-md rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">{t('gestion.erasure_title')}</Text>
            <Text className="mt-2 text-sm text-zinc-600">{t('gestion.erasure_warning')}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={t('gestion.erasure_reason_ph')}
              placeholderTextColor="#a1a1aa"
              multiline
              maxLength={500}
              className="mt-3 min-h-[64px] rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
            />
            <View className="mt-3 flex-row items-center gap-2">
              <Switch value={ack} onValueChange={setAck} />
              <Text className="flex-1 text-sm text-zinc-700">{t('gestion.erasure_ack')}</Text>
            </View>
            <View className="mt-4 flex-row justify-end gap-2">
              <Pressable onPress={close} disabled={busy} className="rounded-full px-4 py-2 active:opacity-60">
                <Text className="text-sm text-zinc-500">{t('gestion.erasure_cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={!ack || busy || !online}
                className="flex-row items-center gap-2 rounded-full bg-red-600 px-4 py-2 active:opacity-80"
                style={!ack || busy || !online ? { opacity: 0.5 } : undefined}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text className="text-sm font-semibold text-white">{t('gestion.erasure_confirm')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

// ── Primitivas ────────────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-sm font-semibold text-[#0F1B2E]">{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs text-zinc-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        maxLength={2000}
        placeholderTextColor="#a1a1aa"
        className={`rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E] ${multiline ? 'min-h-[64px]' : ''}`}
      />
    </View>
  );
}

function ReadRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View>
      <Text className="text-xs text-zinc-500">{label}</Text>
      <Text className="text-sm text-[#0F1B2E]">{value?.trim() || '—'}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  busy,
  variant = 'outline',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'outline' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center gap-2 self-start rounded-full px-4 py-2 active:opacity-60 ${
        variant === 'ghost' ? '' : 'border border-zinc-300'
      }`}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {busy ? <ActivityIndicator size="small" color={BRAND.navy} /> : null}
      <Text className={`text-sm font-medium ${variant === 'ghost' ? 'text-zinc-500' : 'text-[#0F1B2E]'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
