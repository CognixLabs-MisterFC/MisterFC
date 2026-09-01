import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  calledUpLimitApplies,
  calledUpOverflow,
  clearCallupDecisionFromClient,
  eventScopedCacheKey,
  getSharedLineupForEventFromClient,
  getStaffCallupDetailFromClient,
  maxCalledUpFor,
  upsertCallupDecisionFromClient,
  type CallupDecisionRow,
  type CallupDetail,
  type CallupMetaRow,
  type CallupPlayerRow,
  type CallupResponseRow,
  type Role,
  type SharedLineupView,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { callServerEndpoint } from '@/lib/server-api';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { NoAppBadge } from '@/ui/no-app-badge';
import { useTranslations } from '@/locale/provider';
import { PublishCallupSheet } from './publish-callup-sheet';
import { SharedLineupCard } from '@/screens/family/shared-lineup-card';

/**
 * O2-7b-1/7b-2 — Detalle de convocatoria (staff): VER RESPUESTAS de disponibilidad +
 * MARCAR/DESMARCAR citados (7b-1) + PUBLICAR / REPUBLICAR (7b-2). Convocado = roster −
 * descartados (derivado); cada decisión es un upsert INCREMENTAL por jugador. PUBLICAR
 * abre la hoja nativa (hora+lugar) → `/api/callups/publish` con Bearer; REPUBLICAR (si
 * ya publicada y hay cambios sin publicar) es un botón directo al mismo endpoint
 * (mode:'republish'). Todo detrás del WRITE-GUARD: sin red → deshabilitado. El GATE de
 * quién convoca/publica es server-side (`user_can_manage_callup`/RLS); la UI deshabilita
 * lo que el server rechazaría (`canManage`) y un rechazo (42501/403) se maneja con
 * gracia. El fan-out (campana + push) lo dispara el servidor tras publicar. El EQUIPO lo
 * fija el evento. Caché event-scoped; los Map de core se serializan a Record (offline).
 */

/** DTO serializable para la caché (JSON no soporta Map). */
type CallupView = {
  event: CallupDetail['event'];
  roster: CallupPlayerRow[];
  responses: Record<string, CallupResponseRow>;
  decisions: Record<string, CallupDecisionRow>;
  canManage: boolean;
  /** 7b-2 — estado de publicación (para el botón publicar vs republicar). */
  published: boolean;
  hasUnpublishedChanges: boolean;
  /** Meta previa (si hay borrador) para prefill de la hoja de publicar. */
  meta: CallupMetaRow | null;
};

export function ConvocatoriaStaffDetalleScreen({
  eventId,
  readOnly = false,
}: {
  eventId: string | null;
  /**
   * D1b-2 — SOLO CONSULTA (dirección): oculta TODA la barra de acciones (convocar/
   * descartar, limpiar, publicar/republicar, acceso a alineación-editor y a directo)
   * y muestra en su lugar el estado convocado/no-convocado + la alineación oficial
   * COMPARTIDA (si existe). DEFAULT `false` → comportamiento IDÉNTICO al de staff: si
   * alguien olvida el prop, staff sigue funcionando exactamente igual que hoy.
   */
  readOnly?: boolean;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { user } = useSession();
  const router = useRouter();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const role = (activeClub?.role ?? null) as Role | null;
  const userId = user?.id ?? null;
  const accent = theme?.color ?? '#0F1B2E';

  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);

  const { data, fromCache, loading, refresh } = useCached<CallupView | null>(
    eventScopedCacheKey('convocatoria-staff', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId || !role) return null;
      // asStaffMember: detalle dentro del área staff (modo Míster). Si el evento no es
      // de un equipo del director, el scope 'restricted' lo deja fuera (return null),
      // igual que a un entrenador ajeno a ese equipo.
      const d = await getStaffCallupDetailFromClient(sb, {
        clubId,
        role,
        userId,
        eventId,
        asStaffMember: true,
      });
      if (!d) return null;
      return {
        event: d.event,
        roster: d.roster,
        responses: Object.fromEntries(d.responses),
        decisions: Object.fromEntries(d.decisions),
        canManage: d.canManage,
        published: d.meta?.published_at != null,
        hasUnpublishedChanges: d.hasUnpublishedChanges,
        meta: d.meta,
      };
    },
  );

  // D1b-2 — Alineación oficial COMPARTIDA, SOLO en modo consulta (dirección). Con
  // readOnly=false (staff) la KEY es inerte (`shared-lineup.none`) y el fetcher
  // devuelve null: NI se consulta NI se toca la caché real `shared-lineup.<eventId>`
  // (la misma que usa el detalle de familia) → staff intacto. La RLS deja leer al
  // director la alineación oficial vía `user_can_manage_lineup` (admin/director).
  const { data: shared } = useCached<SharedLineupView | null>(
    readOnly && eventId
      ? eventScopedCacheKey('shared-lineup', eventId)
      : 'shared-lineup.none',
    (sb) =>
      readOnly && eventId
        ? getSharedLineupForEventFromClient(sb, eventId)
        : Promise.resolve(null),
  );
  // Se pinta SOLO si hay titulares COLOCADOS en el campo (misma regla que familia);
  // si no, la sección no aparece (sin estado vacío ni mensaje).
  const sharedField =
    shared && shared.positions.some((p) => p.location === 'field') ? shared : null;

  const canWrite = !!data?.canManage && online;

  // 7b-2 — REPUBLICAR (botón directo, sin formulario): re-publica y notifica
  // callup_updated. Solo tras publicar con éxito el servidor dispara el fan-out.
  const onRepublish = useCallback(async () => {
    if (!eventId || !canWrite || pubBusy) return; // write-guard + gate (cliente)
    setPubBusy(true);
    setErrorKey(null);
    try {
      const res = await callServerEndpoint('/api/callups/publish', {
        body: { mode: 'republish', eventId },
      });
      setPubBusy(false);
      if (res.status === 200) {
        refresh();
        void invalidateAfterWrite('upsertCallupDecision');
      } else if (res.status === 403)
        setErrorKey('convocatorias_staff.pub_err_forbidden');
      else setErrorKey('convocatorias_staff.pub_err_generic');
    } catch {
      setPubBusy(false);
      setErrorKey('convocatorias_staff.pub_err_generic');
    }
  }, [eventId, canWrite, pubBusy, refresh]);

  const onDecide = useCallback(
    async (playerId: string, decision: 'called_up' | 'discarded') => {
      if (!eventId || !canWrite || busy) return; // write-guard + gate (cliente)
      setBusy(playerId);
      setErrorKey(null);
      const res = await upsertCallupDecisionFromClient(supabase, {
        event_id: eventId,
        player_id: playerId,
        decision,
        reason: null,
      });
      setBusy(null);
      if (res.ok) {
        refresh();
        void invalidateAfterWrite('upsertCallupDecision');
      } else
        setErrorKey(
          res.error === 'forbidden'
            ? 'convocatorias_staff.forbidden'
            : 'convocatorias_staff.error',
        );
    },
    [eventId, canWrite, busy, refresh],
  );

  const onClear = useCallback(
    async (playerId: string) => {
      if (!eventId || !canWrite || busy) return;
      setBusy(playerId);
      setErrorKey(null);
      const res = await clearCallupDecisionFromClient(supabase, eventId, playerId);
      setBusy(null);
      if (res.ok) {
        refresh();
        void invalidateAfterWrite('upsertCallupDecision');
      } else
        setErrorKey(
          res.error === 'forbidden'
            ? 'convocatorias_staff.forbidden'
            : 'convocatorias_staff.error',
        );
    },
    [eventId, canWrite, busy, refresh],
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('convocatorias.unavailable')} />;

  const roster = data.roster;

  // Convocados = roster − descartados (derivado). Aviso de TOPE por modalidad (solo
  // informativo aquí; el bloqueo duro vive en el publish = 7b-2).
  const discardedCount = roster.filter(
    (p) => data.decisions[p.id]?.decision === 'discarded',
  ).length;
  const calledUp = roster.length - discardedCount;
  const overLimit =
    calledUpLimitApplies(data.event.type) &&
    calledUpOverflow(calledUp, data.event.format) > 0;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-lg font-bold text-[#0F1B2E]" numberOfLines={1}>
          {data.event.title}
          {data.event.opponent_name ? ` · ${data.event.opponent_name}` : ''}
        </Text>
        <Text className="text-xs text-zinc-400" numberOfLines={1}>
          {[
            new Date(data.event.starts_at).toLocaleString(),
            data.event.team_name,
            data.event.category_name,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text className="mt-1 text-xs font-semibold" style={{ color: accent }}>
          {t('convocatorias_staff.called_summary', {
            called: String(calledUp),
            total: String(roster.length),
          })}
        </Text>
        {/* O2-8a/9a — accesos al partido: alineación (pintar; editar en 8b) y directo
            (control de reloj/estado; eventos en 9b). D1b-2: FUERA en modo consulta
            (el director no entra al editor ni al control del directo). */}
        {!readOnly ? (
          <View className="mt-2 flex-row flex-wrap gap-2">
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/staff/alineacion',
                  params: { eventId: data.event.id },
                })
              }
              className="self-start rounded-full border border-zinc-200 px-3 py-1.5 active:opacity-70"
            >
              <Text className="text-xs font-medium" style={{ color: accent }}>
                {t('convocatorias_staff.view_lineup')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/staff/directo',
                  params: { eventId: data.event.id },
                })
              }
              className="self-start rounded-full border border-zinc-200 px-3 py-1.5 active:opacity-70"
            >
              <Text className="text-xs font-medium" style={{ color: accent }}>
                {t('convocatorias_staff.open_live')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Aviso: sin permiso (gate server-side) o sin conexión (write-guard). D1b-2:
          en modo consulta no hay escritura → no aplica ningún banner de acción. */}
      {!readOnly && !data.canManage ? (
        <Banner text={t('convocatorias_staff.no_permission')} />
      ) : !readOnly && !online ? (
        <Banner text={t('convocatorias_staff.offline_write')} />
      ) : null}
      {!readOnly && overLimit ? (
        <View className="bg-amber-50 px-4 py-2">
          <Text className="text-center text-xs text-amber-700">
            {t('convocatorias_staff.over_limit', {
              max: String(maxCalledUpFor(data.event.format)),
            })}
          </Text>
        </View>
      ) : null}
      {errorKey ? (
        <View className="bg-red-50 px-4 py-2">
          <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
        </View>
      ) : null}

      {/* 7b-2 — publicar / republicar. Solo lo ve quien puede gestionar (gate real
          = RLS); write-guard: sin red → deshabilitado. D1b-2: FUERA en consulta. */}
      {!readOnly && data.canManage ? (
        <View className="px-4 pb-1 pt-1">
          {!data.published ? (
            <Pressable
              onPress={() => setSheetOpen(true)}
              disabled={!online}
              className="rounded-xl py-2.5 active:opacity-80"
              style={{ backgroundColor: accent, opacity: online ? 1 : 0.4 }}
            >
              <Text className="text-center text-sm font-semibold text-white">
                {t('convocatorias_staff.publish_cta')}
              </Text>
            </Pressable>
          ) : data.hasUnpublishedChanges ? (
            <View className="flex-row items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <Text className="flex-1 text-xs text-amber-700">
                {t('convocatorias_staff.pending_changes')}
              </Text>
              <Pressable
                onPress={onRepublish}
                disabled={!online || pubBusy}
                className="rounded-full px-3 py-1.5 active:opacity-80"
                style={{ backgroundColor: accent, opacity: !online || pubBusy ? 0.4 : 1 }}
              >
                <Text className="text-xs font-semibold text-white">
                  {pubBusy
                    ? t('convocatorias_staff.publishing')
                    : t('convocatorias_staff.republish_cta')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2">
              <Text className="text-xs font-medium text-emerald-700">
                {t('convocatorias_staff.published_state')}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {roster.length === 0 ? (
        <EmptyState message={t('convocatorias_staff.roster_empty')} />
      ) : (
        <FlatList
          data={roster}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          // D1b-2 — alineación oficial compartida (solo consulta), encima del roster.
          ListHeaderComponent={
            readOnly && sharedField ? (
              <View className="px-4 pt-1 pb-2">
                <SharedLineupCard data={sharedField} accent={accent} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const decision = data.decisions[item.id]?.decision ?? null;
            // Derivado: sin decisión explícita = convocado por defecto.
            const isDiscarded = decision === 'discarded';
            const response = data.responses[item.id]?.status ?? null;
            const isBusy = busy === item.id;
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
                      <Text
                        className="text-[10px] text-amber-600"
                        numberOfLines={1}
                      >
                        {t('convocatorias_staff.promoted')}
                        {item.from_team_name ? ` · ${item.from_team_name}` : ''}
                      </Text>
                    ) : null}
                    {/* Slice C — la familia de este jugador NO recibe la convocatoria
                        ni el aviso al publicar. Solo presentación (se sigue pudiendo
                        convocar igual). El loader solo lo trae en las ramas de staff. */}
                    {item.no_app ? (
                      <NoAppBadge
                        label={t('jugadores.no_app.label')}
                        hint={t('jugadores.no_app.hint')}
                      />
                    ) : null}
                  </View>
                  {/* Respuesta de la familia (ver respuestas). */}
                  <ResponseChip status={response} />
                </View>
                {readOnly ? (
                  // D1b-2 — consulta: estado convocado/no-convocado, sin acciones.
                  <View className="mt-2 flex-row">
                    <View
                      className="rounded-full px-2.5 py-0.5"
                      style={{
                        backgroundColor: isDiscarded ? '#f4f4f5' : '#16a34a',
                      }}
                    >
                      <Text
                        className={
                          isDiscarded
                            ? 'text-[11px] font-medium text-zinc-500'
                            : 'text-[11px] font-semibold text-white'
                        }
                      >
                        {isDiscarded
                          ? t('convocatorias_staff.status_not_called')
                          : t('convocatorias_staff.status_called')}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View className="mt-2 flex-row items-center gap-1.5">
                    <DecisionButton
                      label={t('convocatorias_staff.call_up')}
                      on={!isDiscarded}
                      color="#16a34a"
                      disabled={!canWrite || isBusy}
                      onPress={() => onDecide(item.id, 'called_up')}
                    />
                    <DecisionButton
                      label={t('convocatorias_staff.discard')}
                      on={isDiscarded}
                      color="#3f3f46"
                      disabled={!canWrite || isBusy}
                      onPress={() => onDecide(item.id, 'discarded')}
                    />
                    {decision != null ? (
                      <Pressable
                        onPress={() => onClear(item.id)}
                        disabled={!canWrite || isBusy}
                        className="rounded-full border border-zinc-200 px-3 py-1.5 active:opacity-70"
                        style={{ opacity: !canWrite || isBusy ? 0.4 : 1 }}
                      >
                        <Text className="text-xs text-zinc-500">
                          {t('convocatorias_staff.clear')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* 7b-2 — hoja de publicar (autónoma: hora + lugar + opcionales). D1b-2: no se
          monta en consulta (no hay CTA que la abra). */}
      {!readOnly ? (
        <PublishCallupSheet
          visible={sheetOpen}
          eventId={data.event.id}
          matchStartsAt={data.event.starts_at}
          meta={data.meta}
          accent={accent}
          onClose={() => setSheetOpen(false)}
          onPublished={() => {
            setSheetOpen(false);
            refresh();
          }}
        />
      ) : null}
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

function DecisionButton({
  label,
  on,
  color,
  disabled,
  onPress,
}: {
  label: string;
  on: boolean;
  color: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 active:opacity-70 ${on ? '' : 'border border-zinc-200'}`}
      style={{ backgroundColor: on ? color : undefined, opacity: disabled ? 0.4 : 1 }}
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

function ResponseChip({ status }: { status: 'yes' | 'maybe' | 'no' | null }) {
  const t = useTranslations('');
  const label =
    status === 'yes'
      ? t('convocatorias.resp_yes')
      : status === 'maybe'
        ? t('convocatorias.resp_maybe')
        : status === 'no'
          ? t('convocatorias.resp_no')
          : t('convocatorias.resp_pending');
  const bg =
    status === 'yes'
      ? '#16a34a'
      : status === 'no'
        ? '#dc2626'
        : status === 'maybe'
          ? '#d97706'
          : null;
  return (
    <View
      className="rounded-full px-2 py-0.5"
      style={bg ? { backgroundColor: bg } : { borderWidth: 1, borderColor: '#e4e4e7' }}
    >
      <Text
        className={
          bg ? 'text-[10px] font-semibold text-white' : 'text-[10px] text-zinc-500'
        }
      >
        {label}
      </Text>
    </View>
  );
}
