import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  TRANSPORT_MODES,
  computeCitacionAt,
  publishCallupSchema,
  type CallupMetaRow,
  type TransportMode,
} from '@misterfc/core';
import { callServerEndpoint } from '@/lib/server-api';
import { t } from '@/i18n';

/**
 * O2-7b-2 — Hoja de PUBLICAR convocatoria (staff, nativo). Opción 1: el móvil publica
 * de forma AUTÓNOMA (sin depender de un borrador web). Captura hora de citación
 * (prefill saque−60min, editable) + lugar (obligatorio) + opcionales (dirección,
 * transporte, notas). Valida con `publishCallupSchema` (mismos errores que la web) y
 * envía al route handler `/api/callups/publish` con Bearer (callServerEndpoint). El
 * GATE (quién publica) es la RLS server-side: un 403 se muestra con gracia. Sin
 * "guardar borrador" (queda para futuro): el móvil solo PUBLICA. Write-guard: el botón
 * llega ya deshabilitado sin red (lo gobierna el detalle).
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Construye el ISO de citación: fecha del partido (local) + HH:MM tecleados. */
function buildMeetingIso(matchStartsAt: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const out = new Date(matchStartsAt);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(hh, mm, 0, 0);
  return out.toISOString();
}

type PublishError = string;

export function PublishCallupSheet({
  visible,
  eventId,
  matchStartsAt,
  meta,
  accent,
  onClose,
  onPublished,
}: {
  visible: boolean;
  eventId: string;
  matchStartsAt: string;
  /** Meta previa (borrador guardado desde la web) para prefill; null si no hay. */
  meta: CallupMetaRow | null;
  accent: string;
  onClose: () => void;
  onPublished: () => void;
}) {
  // Prefill de la hora: meta previa → su hora; si no, sugerencia saque−60min.
  const suggestedIso = meta?.meeting_at ?? computeCitacionAt(matchStartsAt);
  const suggested = suggestedIso ? new Date(suggestedIso) : null;
  const [hhmm, setHhmm] = useState(
    suggested ? `${pad(suggested.getHours())}:${pad(suggested.getMinutes())}` : '',
  );
  const [location, setLocation] = useState(meta?.meeting_location ?? '');
  const [address, setAddress] = useState(meta?.meeting_address ?? '');
  const [transport, setTransport] = useState<TransportMode | ''>(
    meta?.transport_mode ?? '',
  );
  const [transportNotes, setTransportNotes] = useState(
    meta?.transport_notes ?? '',
  );
  const [notes, setNotes] = useState(meta?.notes_general ?? '');

  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<PublishError | null>(null);

  const matchDateLabel = (() => {
    const d = new Date(matchStartsAt);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });
  })();

  async function submit() {
    if (busy) return;
    setErrorKey(null);
    const meetingIso = buildMeetingIso(matchStartsAt, hhmm) ?? '';
    const payload = {
      event_id: eventId,
      meeting_at: meetingIso,
      meeting_location: location,
      meeting_address: address || null,
      transport_mode: transport || null,
      transport_notes: transportNotes || null,
      notes_general: notes || null,
      publish: true,
    };

    // Validación cliente (mismos errores que la web) → feedback inmediato.
    const parsed = publishCallupSchema.safeParse(payload);
    if (!parsed.success) {
      setErrorKey(
        `convocatorias_staff.pub_err_${parsed.error.issues[0]?.message ?? 'generic'}`,
      );
      return;
    }

    setBusy(true);
    try {
      const res = await callServerEndpoint('/api/callups/publish', {
        body: payload,
      });
      if (res.status === 200) {
        setBusy(false);
        onPublished();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        overflow?: number;
        maxCalledUp?: number;
      };
      setBusy(false);
      if (res.status === 401) setErrorKey('convocatorias_staff.pub_err_unauthorized');
      else if (res.status === 403) setErrorKey('convocatorias_staff.pub_err_forbidden');
      else if (data.error === 'too_many_called_up')
        setErrorKey(
          t('convocatorias_staff.pub_err_too_many_called_up', {
            overflow: String(data.overflow ?? 0),
            max: String(data.maxCalledUp ?? 0),
          }),
        );
      else setErrorKey(`convocatorias_staff.pub_err_${data.error ?? 'generic'}`);
    } catch {
      setBusy(false);
      setErrorKey('convocatorias_staff.pub_err_generic');
    }
  }

  // errorKey puede ser una clave i18n o un texto ya traducido (too_many): resuélvelo.
  const errorText = errorKey
    ? errorKey.startsWith('convocatorias_staff.')
      ? t(errorKey)
      : errorKey
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end bg-black/50"
        onPress={onClose}
      >
        <Pressable
          className="max-h-[85%] rounded-t-3xl bg-white px-5 pb-8 pt-4"
          onPress={() => {}}
        >
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-zinc-300" />
          <Text className="mb-1 text-lg font-bold text-[#0F1B2E]">
            {t('convocatorias_staff.publish_title')}
          </Text>
          <Text className="mb-4 text-xs text-zinc-400">
            {t('convocatorias_staff.publish_desc')}
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Field label={t('convocatorias_staff.meeting_at')}>
              {matchDateLabel ? (
                <Text className="mb-1 text-[11px] text-zinc-400">
                  {matchDateLabel}
                </Text>
              ) : null}
              <TextInput
                value={hhmm}
                onChangeText={setHhmm}
                placeholder="HH:MM"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-[#0F1B2E]"
              />
            </Field>

            <Field label={t('convocatorias_staff.meeting_location')}>
              <TextInput
                value={location}
                onChangeText={setLocation}
                maxLength={200}
                className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-[#0F1B2E]"
              />
            </Field>

            <Field label={t('convocatorias_staff.meeting_address')}>
              <TextInput
                value={address}
                onChangeText={setAddress}
                maxLength={300}
                className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-[#0F1B2E]"
              />
            </Field>

            <Field label={t('convocatorias_staff.transport_mode')}>
              <View className="flex-row gap-2">
                {TRANSPORT_MODES.map((m) => {
                  const on = transport === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setTransport(on ? '' : m)}
                      className={`rounded-full px-3 py-1.5 active:opacity-70 ${on ? '' : 'border border-zinc-200'}`}
                      style={{ backgroundColor: on ? accent : undefined }}
                    >
                      <Text
                        className={
                          on
                            ? 'text-xs font-semibold text-white'
                            : 'text-xs text-zinc-600'
                        }
                      >
                        {t(`transport_mode.${m}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label={t('convocatorias_staff.transport_notes')}>
              <TextInput
                value={transportNotes}
                onChangeText={setTransportNotes}
                maxLength={500}
                className="rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-[#0F1B2E]"
              />
            </Field>

            <Field label={t('convocatorias_staff.notes_general')}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                maxLength={1000}
                multiline
                className="min-h-16 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-[#0F1B2E]"
              />
            </Field>

            {errorText ? (
              <Text className="mb-2 text-xs text-red-600">{errorText}</Text>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={busy}
              className="mt-2 rounded-xl py-3 active:opacity-80"
              style={{ backgroundColor: accent, opacity: busy ? 0.5 : 1 }}
            >
              <Text className="text-center text-sm font-semibold text-white">
                {busy
                  ? t('convocatorias_staff.publishing')
                  : t('convocatorias_staff.publish_now')}
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </Text>
      {children}
    </View>
  );
}
