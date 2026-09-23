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
  getPlayerTutorsContactFromClient,
  canOfferSelfRevoke,
  getSelfAccountStatusFromClient,
  getSelfRevokeGateFromClient,
  revokePlayerSelfAccountFromClient,
  selfAccountStatusMessageKey,
  selfRevokeDoneMessageKey,
  playerScopedCacheKey,
  playerPhotoUploadSchema,
  requestPlayerErasureFromClient,
  setPlayerMedicalFromClient,
  setPlayerPhotoPathFromClient,
  type PlayerManagementAccess,
  type PlayerMedical,
  type PlayerTutorsContactResult,
  type SelfAccountStatus,
  type SelfRevokeGate,
  type SelfRevokeOutcome,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { MIME_TO_EXT, base64ToBytes } from '@/lib/image-upload';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useActivePlayer } from '@/auth/active-player';
import { tutorContactRows, type TutorContactRow } from '@/player-contact/tutor-rows';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { ChildSelector } from '@/ui/child-selector';
import { PlayerAvatar } from '@/ui/player-avatar';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { KeyboardModalView } from '@/ui/keyboard';
import { appLocale, useTranslations } from '@/locale/provider';
import { callServerEndpoint, downloadServerFile } from '@/lib/server-api';
import { BRAND } from '@/theme';

/**
 * O2-5 C2 — GESTIÓN SENSIBLE del HIJO ACTIVO (la pieza más delicada de Familia):
 * foto (Storage privado, cara de un MENOR), datos médicos (cerrados por RPC +
 * consentimiento) y derecho al olvido (SOLICITUD irreversible). Todas las escrituras
 * pasan por RPC SECURITY DEFINER de core; el write-guard bloquea sin conexión.
 *
 * MN-6 — esta pantalla la abre también el JUGADOR con cuenta propia, y ve lo que le
 * corresponde: la foto (superficie COMPARTIDA) sí; médica, expediente y supresión no
 * mientras sea menor (superficie RESERVADA). Cada tarjeta pregunta por el helper que
 * gobierna SU RPC, no por uno común: ofrecer un botón que el SQL va a denegar es el
 * defecto que MN-6 viene a quitar.
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
  // MN-9 — estado de la cuenta propia del jugador (none | invited | linked). Es lo
  // que decide qué enseña la tarjeta de acceso; antes se miraba la relación de quien
  // mira, que en el tutor es 'parent' para siempre y por eso no se iba nunca.
  const selfStatus = useCached<SelfAccountStatus | null>(
    playerScopedCacheKey('self-status', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getSelfAccountStatusFromClient(sb, playerId) : Promise.resolve(null)),
  );
  // RC-2 — los DOS predicados con los que se gatea `revoke_player_self_account`.
  // Se preguntan tal cual y no se derivan de `canManageSensitive`: un equivalente no
  // es el mismo predicado, y el dia que uno cambie la tarjeta y el boton dirian cosas
  // distintas. La decision (`canOfferSelfRevoke`) vive en core porque la web toma la
  // misma, y una regla escrita dos veces se queda coja en una.
  const revokeGate = useCached<SelfRevokeGate>(
    playerScopedCacheKey('self-revoke-gate', clubId ?? 'none', playerId ?? 'none'),
    (sb) =>
      playerId
        ? getSelfRevokeGateFromClient(sb, playerId)
        : Promise.resolve({ isTutor: false, isMinor: false }),
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (access.loading) return <LoadingScreen />;

  // MN-6 — dos superficies, no una. `canManage` es la COMPARTIDA (foto: lo que el
  // menor con cuenta propia SÍ hace) y `canManageSensitive` la RESERVADA (médica,
  // expediente y supresión: los bloques que Jose deja al tutor mientras el jugador
  // sea menor). Antes las cuatro tarjetas colgaban de un único `isTutor`, así que o
  // se veían todas o no se veía la pantalla.
  const canManage = access.data?.canManage ?? false;
  const canManageSensitive = access.data?.canManageSensitive ?? false;
  const canWriteMedical = access.data?.canWriteMedical ?? false;
  const fromCache =
    access.fromCache ||
    medical.fromCache ||
    photo.fromCache ||
    selfStatus.fromCache ||
    revokeGate.fromCache;
  const initials = (activePlayer?.name ?? '').trim().slice(0, 2);

  // La pantalla entera cuelga de la COMPARTIDA: sin ella no hay ni foto que tocar.
  if (!canManage) {
    return (
      <View className="flex-1 bg-white">
        <EmptyState message={t('gestion.not_tutor')} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      {!online ? (
        <View className="bg-zinc-100 px-4 py-2">
          <Text className="text-center text-xs text-zinc-500">{t('gestion.offline_write')}</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        {/* De quién son estos datos. Esta pantalla edita alergias y medicación y
            pide el borrado RGPD de UN menor: escribir en la ficha del hermano
            equivocado es un daño real y silencioso. No es un selector — para
            cambiar de hijo se va al inicio. */}
        <View className="flex-row">
          <ChildSelector readOnly />
        </View>
        <PhotoCard
          playerId={playerId}
          accent={accent}
          initials={initials}
          path={photo.data ?? null}
          online={online}
          onChanged={photo.refresh}
        />
        {/* COMPARTIDA — el contacto de los tutores. La puerta de la RPC
            (`user_can_access_player_contact`) deja pasar al tutor Y al jugador con
            cuenta propia, así que esta tarjeta cuelga de `canManage` como la foto y
            no de la reservada: que el menor vea a sus tutores es justo el encargo. */}
        <TutorsContactCard playerId={playerId} clubId={clubId} />
        {/* RESERVADA — `set_player_medical` y la lectura por `get_player_medical`
            exigen user_manages_player_sensitive. Al menor con cuenta propia no se
            le pinta: el SQL se lo negaría y no se ofrece lo que va a fallar. */}
        {canManageSensitive ? (
          <MedicalCard
            key={playerId}
            playerId={playerId}
            initial={medical.data ?? null}
            canWrite={canWriteMedical}
            online={online}
            loading={medical.loading}
          />
        ) : null}
        {/* MN-5 — Dar acceso al jugador. MN-9 — lo que se enseña lo decide el ESTADO
            del jugador, no la relacion de quien mira: la del tutor es 'parent' para
            siempre, asi que la tarjeta no se iba nunca aunque el hijo ya tuviera
            cuenta. El estado viene de `player_self_account_status`, porque el tutor NO
            VE la fila 'self' de su hijo (se la oculta la RLS de `player_accounts`).
            Al PROPIO jugador le desaparece por este MISMO camino: la RPC esta gateada
            con `user_manages_player`, asi que a el le contesta 'linked'.
            `null` = no se ha podido saber -> no se ofrece, igual que `canManage`. */}
        {selfStatus.data != null ? (
          <AccessCard
            playerId={playerId}
            playerName={activePlayer?.name ?? ''}
            status={selfStatus.data}
            online={online}
            onInvited={selfStatus.refresh}
            canRevoke={canOfferSelfRevoke({
              status: selfStatus.data,
              gate: revokeGate.data ?? { isTutor: false, isMinor: false },
            })}
            onRevoked={() => {
              selfStatus.refresh();
              revokeGate.refresh();
            }}
          />
        ) : null}
        {/* RESERVADAS — `record_data_export` y `request_player_erasure`, las dos
            sobre user_manages_player_sensitive. */}
        {canManageSensitive ? (
          <>
            <ExportCard playerId={playerId} online={online} />
            <ErasureCard playerId={playerId} online={online} />
          </>
        ) : null}
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
    if ('ok' in res) {
      onChanged();
      void invalidateAfterWrite('setPlayerPhoto');
    } else setError(t('gestion.photo_err_generic'));
  }

  async function remove() {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    const res = await clearPlayerPhotoFromClient(supabase, playerId);
    setBusy(false);
    if ('ok' in res) {
      onChanged();
      void invalidateAfterWrite('setPlayerPhoto');
    } else setError(t('gestion.photo_err_generic'));
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
    if ('ok' in res) {
      setState('saved');
      void invalidateAfterWrite('setPlayerMedical');
    } else setState(res.error === 'forbidden' ? 'forbidden' : 'error');
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
        <KeyboardModalView className="flex-1 items-center justify-center bg-black/50 px-6">
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
        </KeyboardModalView>
      </Modal>
    </Card>
  );
}

// ── Contacto de los tutores ──────────────────────────────────────────────────
/**
 * Nombre, correo y teléfono de los tutores del jugador.
 *
 * QUIÉN LO VE. La RPC ya resuelve los dos casos sin tocar SQL: su puerta es
 * `user_can_access_player_contact`, que incluye `user_manages_player` = tutor O el
 * propio jugador. Y devuelve TODAS las filas de `player_accounts`, así que un tutor
 * ve aquí a los demás tutores del mismo jugador.
 *
 * SON DATOS DE TERCEROS, y aquí SOLO SE LEEN. Nombre, correo y teléfono en texto
 * plano, no pulsables, y ninguna acción: nada abre el marcador ni el cliente de
 * correo. Hubo botones de llamar y escribir detrás de una confirmación y Jose los
 * quitó; no volver a ponerlos sin que lo pida. La ficha de DIRECCIÓN sí hace el
 * número pulsable, y ahí está bien: un entrenador con una urgencia en el campo
 * necesita un toque. Una familia no tiene esa urgencia.
 *
 * Los tres estados de la lectura no se colapsan: `forbidden` no pinta la tarjeta,
 * un fallo lo DICE, y «sin tutores» es su propio mensaje.
 */
function TutorsContactCard({ playerId, clubId }: { playerId: string; clubId: string | null }) {
  const t = useTranslations('');
  const { user } = useSession();

  const { data, loading } = useCached<PlayerTutorsContactResult | null>(
    playerScopedCacheKey('tutors-contact', clubId ?? 'none', playerId),
    (sb) => getPlayerTutorsContactFromClient(sb, playerId),
  );

  if (loading) {
    return (
      <Card title={t('gestion.contact_title')}>
        <ActivityIndicator size="small" />
      </Card>
    );
  }
  if (!data) return null;
  if (!data.ok) {
    // Sin acceso no se pinta nada: no hay nada que explicarle a quien no debe verlo.
    if (data.reason === 'forbidden') return null;
    return (
      <Card title={t('gestion.contact_title')}>
        <Text className="text-xs text-red-600">{t('gestion.contact_error')}</Text>
      </Card>
    );
  }

  const rows = tutorContactRows(data.tutors, user?.id ?? null);

  return (
    <Card title={t('gestion.contact_title')}>
      <Text className="mb-2 text-xs text-zinc-400">{t('gestion.contact_hint')}</Text>
      {rows.length === 0 ? (
        <Text className="text-sm text-zinc-500">{t('gestion.contact_none')}</Text>
      ) : (
        rows.map((row, i) => (
          <TutorRow key={row.tutorProfileId} row={row} first={i === 0} />
        ))
      )}
    </Card>
  );
}

function TutorRow({ row, first }: { row: TutorContactRow; first: boolean }) {
  const t = useTranslations('');
  const relation = t(`jugadores.family.relation.${row.relation}`);
  const name = row.fullName ?? relation;

  return (
    <View className={first ? 'py-2' : 'mt-1 border-t border-zinc-100 pt-2'}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
          {name}
        </Text>
        {row.isViewer ? (
          <Text className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">
            {t('gestion.contact_you')}
          </Text>
        ) : null}
      </View>
      <Text className="text-[10px] uppercase tracking-wide text-zinc-400">{relation}</Text>
      {/* Texto plano y NO pulsable: se ve y se queda ahí. */}
      <ReadRow label={t('ficha.contact_email')} value={row.email} />
      <ReadRow label={t('ficha.contact_phone')} value={row.phone} />
    </View>
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

// ── Acceso del jugador (MN-5) ───────────────────────────────────────────────
//
// El tutor le abre al jugador su propia cuenta, y esa invitacion ES la autorizacion.
// El formulario manda SOLO el email: la relacion la escribe la RPC en 'self' y no
// viaja nunca desde el cliente. Mismo patron que el modal de invitar seguidor.
//
// La tarjeta se pinta siempre que haya tutor, sin preguntar antes si el jugador ya
// tiene cuenta: esa respuesta puede quedar rancia entre el render y el envio, y el
// endpoint devuelve `already_linked` con su propio texto.
type AccessOutcome =
  | 'ok'
  | 'existing'
  | 'forbidden'
  | 'email_invalid'
  | 'already_linked'
  | 'email_relation_conflict'
  | 'consents_required'
  | 'no_active_season'
  | 'erased'
  | 'error';

function AccessCard({
  playerId,
  playerName,
  status,
  online,
  onInvited,
  canRevoke,
  onRevoked,
}: {
  playerId: string;
  playerName: string;
  status: SelfAccountStatus;
  online: boolean;
  onInvited: () => void;
  /** RC-2 — lo decide `canOfferSelfRevoke` fuera, con los predicados del SQL. */
  canRevoke: boolean;
  onRevoked: () => void;
}) {
  const t = useTranslations('');
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<AccessOutcome | null>(null);

  const close = () => {
    if (sending) return;
    // MN-9 — si se ha enviado, el estado del jugador ha cambiado a 'invited': hay que
    // releerlo o la tarjeta seguiria ofreciendo invitar hasta el proximo arranque.
    const enviada = outcome === 'ok' || outcome === 'existing';
    setEmail('');
    setOutcome(null);
    setOpen(false);
    if (enviada) onInvited();
  };

  const submit = async () => {
    const trimmed = email.trim();
    if (!online || sending || !trimmed) return; // write-guard
    setSending(true);
    setOutcome(null);
    try {
      const res = await callServerEndpoint('/api/players/self-invite', {
        method: 'POST',
        body: { playerId, email: trimmed, locale: appLocale() },
      });
      let json: { status?: string; error?: string } = {};
      try {
        json = (await res.json()) as { status?: string; error?: string };
      } catch {
        json = {};
      }
      if (res.ok) {
        setOutcome(json.status === 'existing' ? 'existing' : 'ok');
      } else {
        // El endpoint devuelve el gate por nombre; se acepta solo si lo conocemos,
        // para que un error nuevo no acabe pintando una cadena que no existe.
        const known: AccessOutcome[] = [
          'forbidden',
          'email_invalid',
          'already_linked',
          'email_relation_conflict',
          'consents_required',
          'no_active_season',
          'erased',
        ];
        const got = json.error as AccessOutcome | undefined;
        setOutcome(got && known.includes(got) ? got : 'error');
      }
    } catch {
      // no_web_url / no_session / red caida
      setOutcome('error');
    } finally {
      setSending(false);
    }
  };

  const success = outcome === 'ok' || outcome === 'existing';
  const errorKey =
    outcome && !success
      ? outcome === 'error'
        ? 'invite_self.errors.generic'
        : `invite_self.errors.${outcome}`
      : null;

  return (
    <View className="rounded-2xl border border-zinc-200 bg-white p-4">
      <Text className="text-base font-bold text-[#0F1B2E]">
        {t('invite_self.section.title')}
      </Text>
      {status === 'none' ? (
        <>
          <Text className="mt-1 text-sm text-zinc-600">{t('invite_self.section.hint')}</Text>
          <Pressable
            onPress={() => setOpen(true)}
            disabled={!online}
            className={`mt-3 self-start rounded-full px-4 py-2 ${
              online ? 'bg-[#0F1B2E] active:opacity-80' : 'bg-zinc-300'
            }`}
          >
            <Text className="text-sm font-semibold text-white">{t('invite_self.action')}</Text>
          </Pressable>
        </>
      ) : (
        // MN-10 — los motivos de bloqueo dicen POR QUE, con el MISMO texto que
        // enseñaba la RPC despues de pulsar. La clave la da core: web y nativa pintan
        // los mismos estados y una lista escrita dos veces se queda coja en una. Sin
        // recuento a mano: RC-A anadio 'account_deletion_pending' y esta linea decia
        // seis.
        <>
          <Text className="mt-1 text-sm text-zinc-600">
            {t(`invite_self.${selfAccountStatusMessageKey(status) ?? 'section.hint'}`)}
          </Text>
          {/* RC-2 — retirar. NO cuelga del estado a secas: `player_self_account_status`
              esta gateada con `user_manages_player`, asi que al PROPIO jugador le
              contesta 'linked' igual que a su padre (MN-9, a proposito). Si colgara del
              estado, un chaval de 18 con su cuenta veria un boton que el SQL le niega. */}
          {canRevoke ? (
            <RevokeAccessButton
              playerId={playerId}
              playerName={playerName}
              invitedOnly={status === 'invited'}
              online={online}
              onRevoked={onRevoked}
            />
          ) : null}
        </>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardModalView className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full max-w-md rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">
              {t('invite_self.title')}
            </Text>
            {success ? (
              <>
                <Text className="mt-2 text-sm text-zinc-700">
                  {t('invite_self.sent', { email: email.trim() })}
                </Text>
                <View className="mt-4 flex-row justify-end">
                  <Pressable
                    onPress={close}
                    className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                  >
                    <Text className="text-sm font-semibold text-white">
                      {t('invite_self.close')}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text className="mt-2 text-sm text-zinc-600">
                  {t('invite_self.description', { player: playerName })}
                </Text>
                <Text className="mt-3 text-xs font-semibold uppercase text-zinc-500">
                  {t('invite_self.field.email')}
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!sending}
                  className="mt-1 rounded-xl border border-zinc-300 px-3 py-2 text-base text-[#0F1B2E]"
                />
                <Text className="mt-1 text-xs text-zinc-500">
                  {t('invite_self.field.help')}
                </Text>
                {errorKey ? (
                  <Text className="mt-2 text-sm text-red-600">{t(errorKey)}</Text>
                ) : null}
                <View className="mt-4 flex-row justify-end gap-2">
                  <Pressable onPress={close} className="rounded-full px-4 py-2 active:opacity-60">
                    <Text className="text-sm font-semibold text-zinc-600">
                      {t('invite_self.cancel')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={submit}
                    disabled={sending || !online || email.trim().length === 0}
                    className={`rounded-full px-4 py-2 ${
                      sending || !online || email.trim().length === 0
                        ? 'bg-zinc-300'
                        : 'bg-[#0F1B2E] active:opacity-80'
                    }`}
                  >
                    <Text className="text-sm font-semibold text-white">
                      {t('invite_self.send')}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardModalView>
      </Modal>
    </View>
  );
}

/**
 * RC-2 — «Retirar el acceso», con confirmacion.
 *
 * Llama a `revoke_player_self_account` DIRECTAMENTE con el cliente de la sesion, sin
 * pasar por un endpoint del servidor. Es la diferencia con invitar, que si lo
 * necesita: alli hay que crear una cuenta y mandar un correo, y eso es service-role.
 * Aqui no hay nada de eso — la autoridad entera esta en el SQL.
 *
 * Que quien mira vea este boton lo decide `canOfferSelfRevoke` fuera, con los DOS
 * predicados con los que se gatea la RPC. Aqui no se vuelve a decidir nada.
 *
 * LA CONFIRMACION DICE TAMBIEN LO QUE NO PASA: retirar el acceso no da de baja al
 * jugador. Sigue en el club, en su equipo y en sus convocatorias. Sin esa frase,
 * «retirar» suena a borrar al nino.
 */
function RevokeAccessButton({
  playerId,
  playerName,
  invitedOnly,
  online,
  onRevoked,
}: {
  playerId: string;
  playerName: string;
  invitedOnly: boolean;
  online: boolean;
  onRevoked: () => void;
}) {
  const t = useTranslations('');
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);

  const confirmar = async () => {
    if (!online || working) return; // write-guard
    setWorking(true);
    setErrorKey(null);
    try {
      const res = await revokePlayerSelfAccountFromClient(supabase, playerId);
      if ('error' in res) {
        setErrorKey(`invite_self.revoke.errors.${res.error}`);
        return;
      }
      // El resultado dice QUE habia: cancelar una invitacion que nadie llego a usar no
      // es lo mismo que quitarle el acceso a quien ya estaba dentro.
      const outcome: SelfRevokeOutcome = res.ok;
      setDoneKey(`invite_self.revoke.${selfRevokeDoneMessageKey(outcome)}`);
      setOpen(false);
      // La tarjeta se relee: el estado ha cambiado y, si no, seguiria ofreciendo
      // retirar lo que ya no esta hasta el proximo arranque (la leccion de MN-9).
      void invalidateAfterWrite('revokePlayerSelfAccount');
      onRevoked();
    } catch {
      setErrorKey('invite_self.revoke.errors.generic');
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => {
          setErrorKey(null);
          setOpen(true);
        }}
        disabled={!online}
        className={`mt-3 self-start rounded-full border px-4 py-2 ${
          online ? 'border-red-300 active:opacity-70' : 'border-zinc-200'
        }`}
      >
        <Text className={`text-sm font-semibold ${online ? 'text-red-600' : 'text-zinc-400'}`}>
          {t('invite_self.revoke.action')}
        </Text>
      </Pressable>

      {doneKey ? (
        <Text className="mt-2 text-sm text-zinc-600">{t(doneKey)}</Text>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => (working ? undefined : setOpen(false))}
      >
        <View className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full max-w-md rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">
              {t('invite_self.revoke.title')}
            </Text>
            <Text className="mt-2 text-sm text-zinc-700">
              {t(
                invitedOnly
                  ? 'invite_self.revoke.confirm_invited'
                  : 'invite_self.revoke.confirm',
                { player: playerName },
              )}
            </Text>
            <Text className="mt-2 text-sm text-zinc-500">
              {t('invite_self.revoke.keeps_player')}
            </Text>
            {errorKey ? (
              <Text className="mt-2 text-sm text-red-600">{t(errorKey)}</Text>
            ) : null}
            <View className="mt-4 flex-row justify-end gap-2">
              <Pressable
                onPress={() => (working ? undefined : setOpen(false))}
                className="rounded-full px-4 py-2 active:opacity-60"
              >
                <Text className="text-sm font-semibold text-zinc-600">
                  {t('invite_self.revoke.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmar}
                disabled={working || !online}
                className={`rounded-full px-4 py-2 ${
                  working || !online ? 'bg-zinc-300' : 'bg-red-600 active:opacity-80'
                }`}
              >
                <Text className="text-sm font-semibold text-white">
                  {t('invite_self.revoke.confirm_action')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
