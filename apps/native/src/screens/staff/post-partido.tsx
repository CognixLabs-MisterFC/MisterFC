import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  deleteEvaluationFromClient,
  deleteTeamEvaluationFromClient,
  eventScopedCacheKey,
  formatPlayerName,
  getPostMatchFromClient,
  reopenMatchFromClient,
  setPostMatchDoneFromClient,
  upsertEvaluationFromClient,
  upsertTeamEvaluationFromClient,
  RATING_MIN,
  RATING_MAX,
  type PostMatchData,
  type PostMatchError,
  type PostMatchPlayer,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { MatchPickerScreen } from '@/screens/staff/match-picker';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-9c — POST-PARTIDO (staff). Cierra CAMPO C. Muestra el RESULTADO FINAL y las
 * stats consolidadas (de finishMatch/9a, solo lectura) y deja VALORAR: nota 1-10 +
 * MVP + comentario por jugador (incremental, como la web), valoración colectiva, y
 * completar/reabrir la etapa. Para CORREGIR el resultado, se REABRE el partido
 * (vuelve al directo de 9a/9b; al re-finalizar reconsolida) — no editamos eventos
 * aquí. Todo ESCRITURA DIRECTA con RLS y ONLINE (write-guard: sin red → deshabilitado
 * con aviso; NO es la cola de 9b). Modelo de valoraciones REUTILIZADO de core (F8),
 * no reimplementado. Caché event-scoped `post-partido.${eventId}`.
 */

type Draft = { rating: number | null; comment: string; isMvp: boolean };
type TeamDraft = { rating: number | null; comment: string };
type Busy = null | string | 'team' | 'stage' | 'reopen';

function draftOf(p: PostMatchPlayer): Draft {
  return {
    rating: p.evaluation?.rating ?? null,
    comment: p.evaluation?.comment ?? '',
    isMvp: p.evaluation?.isMvp ?? false,
  };
}

function errorKeyFor(e: PostMatchError): string {
  switch (e) {
    case 'forbidden':
      return 'post_partido.err_forbidden';
    case 'rating_required':
      return 'post_partido.err_rating_required';
    case 'mvp_taken':
      return 'post_partido.err_mvp_taken';
    case 'not_closed':
      return 'post_partido.err_not_closed';
    case 'empty':
      return 'post_partido.err_empty';
    default:
      return 'post_partido.err_generic';
  }
}

export function PostMatchScreen({ eventId }: { eventId: string | null }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<PostMatchData | null>(
    eventScopedCacheKey('post-partido', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId) return null;
      return getPostMatchFromClient(sb, clubId, eventId);
    },
  );

  // Semilla de drafts desde lo GUARDADO; se resiembra en cada fetch nuevo
  // (identidad de `data` cambia) en fase de render — patrón React-Compiler-safe (8b).
  const [seed, setSeed] = useState<PostMatchData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [teamDraft, setTeamDraft] = useState<TeamDraft>({ rating: null, comment: '' });
  if (data && data !== seed) {
    setSeed(data);
    setDrafts(Object.fromEntries(data.players.map((p) => [p.playerId, draftOf(p)])));
    setTeamDraft({
      rating: data.teamEvaluation?.rating ?? null,
      comment: data.teamEvaluation?.comment ?? '',
    });
  }

  const [busy, setBusy] = useState<Busy>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canRecord = !!data?.canRecord;
  const status = data?.matchStatus ?? 'not_started';
  const editable = canRecord && online && busy === null;

  const setDraft = useCallback((playerId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const cur = prev[playerId] ?? { rating: null, comment: '', isMvp: false };
      const next = { ...cur, ...patch };
      // MVP exclusivo en UI: marcar a uno desmarca al resto (como la web).
      if (patch.isMvp === true) {
        const cleared: Record<string, Draft> = {};
        for (const [id, d] of Object.entries(prev)) {
          cleared[id] = id === playerId ? next : { ...d, isMvp: false };
        }
        return cleared;
      }
      return { ...prev, [playerId]: next };
    });
  }, []);

  const savePlayer = useCallback(
    async (p: PostMatchPlayer) => {
      if (!eventId || !editable) return;
      const d = drafts[p.playerId];
      if (!d || d.rating == null) {
        setErrorKey('post_partido.err_rating_required');
        return;
      }
      setBusy(p.playerId);
      setErrorKey(null);
      const r = await upsertEvaluationFromClient(supabase, {
        event_id: eventId,
        player_id: p.playerId,
        rating: d.rating,
        comment: d.comment.trim() === '' ? null : d.comment.trim(),
        is_mvp: d.isMvp,
      });
      setBusy(null);
      if (!r.ok) setErrorKey(errorKeyFor(r.error));
      else {
        refresh();
        void invalidateAfterWrite('postMatch');
      }
    },
    [eventId, editable, drafts, refresh],
  );

  const removePlayer = useCallback(
    async (p: PostMatchPlayer) => {
      if (!eventId || !editable) return;
      setBusy(p.playerId);
      setErrorKey(null);
      const r = await deleteEvaluationFromClient(supabase, {
        event_id: eventId,
        player_id: p.playerId,
      });
      setBusy(null);
      if (!r.ok) setErrorKey(errorKeyFor(r.error));
      else {
        refresh();
        void invalidateAfterWrite('postMatch');
      }
    },
    [eventId, editable, refresh],
  );

  const saveTeam = useCallback(async () => {
    if (!eventId || !editable || teamDraft.rating == null) return;
    setBusy('team');
    setErrorKey(null);
    const r = await upsertTeamEvaluationFromClient(supabase, {
      event_id: eventId,
      rating: teamDraft.rating,
      comment: teamDraft.comment.trim() === '' ? null : teamDraft.comment.trim(),
    });
    setBusy(null);
    if (!r.ok) setErrorKey(errorKeyFor(r.error));
    else {
      refresh();
      void invalidateAfterWrite('postMatch');
    }
  }, [eventId, editable, teamDraft, refresh]);

  const removeTeam = useCallback(async () => {
    if (!eventId || !editable) return;
    setBusy('team');
    setErrorKey(null);
    const r = await deleteTeamEvaluationFromClient(supabase, { event_id: eventId });
    setBusy(null);
    if (!r.ok) setErrorKey(errorKeyFor(r.error));
    else {
      refresh();
      void invalidateAfterWrite('postMatch');
    }
  }, [eventId, editable, refresh]);

  const setStageDone = useCallback(
    async (done: boolean) => {
      if (!eventId || !editable) return;
      setBusy('stage');
      setErrorKey(null);
      const r = await setPostMatchDoneFromClient(supabase, { event_id: eventId, done });
      setBusy(null);
      if (!r.ok) setErrorKey(errorKeyFor(r.error));
      else {
        refresh();
        void invalidateAfterWrite('postMatch');
      }
    },
    [eventId, editable, refresh],
  );

  const reopen = useCallback(async () => {
    if (!eventId || !editable) return;
    setBusy('reopen');
    setErrorKey(null);
    const r = await reopenMatchFromClient(supabase, { event_id: eventId });
    setBusy(null);
    if (!r.ok) {
      setErrorKey(r.error === 'forbidden' ? 'post_partido.err_forbidden' : 'post_partido.err_generic');
      return;
    }
    // Reabierto → volver al directo (9a/9b) a corregir; al re-finalizar reconsolida.
    router.replace({ pathname: '/staff/directo', params: { eventId } });
  }, [eventId, editable, router]);

  // E7 — Sin eventId (abierta desde el menú): selector de partido en vez de un texto
  // sin salida (partidos de la temporada, pasados y futuros).
  if (!eventId) return <MatchPickerScreen target="post-partido" />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('post_partido.unavailable')} />;

  const scoreText =
    data.score.own != null && data.score.against != null
      ? `${data.score.own} - ${data.score.against}`
      : '— - —';

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}>
        <ScreenTitle>{t('post_partido.app_title')}</ScreenTitle>

        {/* Resultado final (consolidado por finishMatch/9a). */}
        <View
          className="rounded-2xl border border-zinc-200 p-4"
          style={{ borderLeftWidth: 4, borderLeftColor: accent }}
        >
          <View className="flex-row items-center justify-center gap-3">
            <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {data.event.teamName}
            </Text>
            <Text className="text-3xl font-extrabold text-[#0F1B2E] tabular-nums">{scoreText}</Text>
            <Text className="text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {data.event.opponentName ?? ''}
            </Text>
          </View>
          <Text className="mt-1 text-center text-xs text-zinc-400">
            {data.postMatchDone ? t('post_partido.stage_done') : t('post_partido.stage_open')}
          </Text>
        </View>

        {/* Estado no cerrado (reabierto o sin finalizar): no se valora. */}
        {status !== 'closed' ? (
          <Banner text={t('post_partido.not_closed_warning')} />
        ) : !canRecord ? (
          <Banner text={t('post_partido.no_permission')} />
        ) : !online ? (
          <Banner text={t('post_partido.offline_write')} />
        ) : null}
        {errorKey ? (
          <View className="rounded-xl bg-red-50 px-4 py-2">
            <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
          </View>
        ) : null}

        {status === 'closed' ? (
          <>
            {/* Valoración colectiva del equipo. */}
            <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 10 }}>
              <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('post_partido.team_eval')}
              </Text>
              <RatingScale
                value={teamDraft.rating}
                accent={accent}
                disabled={!editable}
                onPick={(n) => setTeamDraft((s) => ({ ...s, rating: s.rating === n ? null : n }))}
              />
              <TextInput
                value={teamDraft.comment}
                onChangeText={(v) => setTeamDraft((s) => ({ ...s, comment: v }))}
                editable={editable}
                placeholder={t('post_partido.comment_ph')}
                multiline
                className="min-h-[44px] rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
              />
              <View className="flex-row gap-2">
                <Btn
                  label={t('post_partido.save')}
                  accent={accent}
                  disabled={!editable || teamDraft.rating == null}
                  onPress={saveTeam}
                  primary
                />
                {data.teamEvaluation ? (
                  <Btn
                    label={t('post_partido.clear')}
                    accent={accent}
                    disabled={!editable}
                    onPress={removeTeam}
                  />
                ) : null}
              </View>
            </View>

            {/* Valoraciones individuales (solo jugadores que participaron / ya valorados). */}
            <Text className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('post_partido.players')}
            </Text>
            {data.players.length === 0 ? (
              <Text className="py-2 text-sm text-zinc-400">{t('post_partido.app_no_players')}</Text>
            ) : (
              data.players.map((p) => (
                <PlayerCard
                  key={p.playerId}
                  player={p}
                  draft={drafts[p.playerId] ?? { rating: null, comment: '', isMvp: false }}
                  accent={accent}
                  editable={editable}
                  saving={busy === p.playerId}
                  onSetDraft={(patch) => setDraft(p.playerId, patch)}
                  onSave={() => savePlayer(p)}
                  onRemove={() => removePlayer(p)}
                />
              ))
            )}

            {/* Completar / reabrir la ETAPA de valoraciones. */}
            <View className="mt-1 rounded-2xl border border-zinc-200 p-4" style={{ gap: 8 }}>
              {data.postMatchDone ? (
                <Btn
                  label={t('post_partido.app_reopen_stage')}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => setStageDone(false)}
                />
              ) : (
                <Btn
                  label={t('post_partido.complete_stage')}
                  accent={accent}
                  disabled={!editable}
                  onPress={() => setStageDone(true)}
                  primary
                />
              )}
              {/* Corregir el resultado = REABRIR el partido (vuelve al directo). */}
              <ConfirmBtn
                label={t('post_partido.reopen_match')}
                confirmLabel={t('post_partido.reopen_match_confirm')}
                disabled={!editable}
                onConfirm={reopen}
              />
              <Text className="text-center text-[11px] text-zinc-400">
                {t('post_partido.reopen_hint')}
              </Text>
            </View>
          </>
        ) : (
          <Btn
            label={t('post_partido.go_directo')}
            accent={accent}
            disabled={false}
            onPress={() => router.replace({ pathname: '/staff/directo', params: { eventId } })}
            primary
          />
        )}
      </ScrollView>
    </View>
  );
}

/** Escala de nota 1-10 (botones). */
function RatingScale({
  value,
  accent,
  disabled,
  onPick,
}: {
  value: number | null;
  accent: string;
  disabled: boolean;
  onPick: (n: number) => void;
}) {
  const nums = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {nums.map((n) => {
        const sel = value === n;
        return (
          <Pressable
            key={n}
            disabled={disabled}
            onPress={() => onPick(n)}
            className="h-9 w-9 items-center justify-center rounded-lg active:opacity-70"
            style={{
              borderWidth: 1.5,
              borderColor: sel ? accent : '#e4e4e7',
              backgroundColor: sel ? accent : undefined,
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <Text className={`text-sm font-semibold ${sel ? 'text-white' : 'text-[#0F1B2E]'} tabular-nums`}>
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayerCard({
  player,
  draft,
  accent,
  editable,
  saving,
  onSetDraft,
  onSave,
  onRemove,
}: {
  player: PostMatchPlayer;
  draft: Draft;
  accent: string;
  editable: boolean;
  saving: boolean;
  onSetDraft: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('');
  const name = formatPlayerName(player.firstName, player.lastName);
  const s = player.stats;
  const hasEval = player.evaluation?.rating != null;
  return (
    <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 8 }}>
      <View className="flex-row items-center gap-2">
        {player.dorsal != null ? (
          <Text className="text-xs font-bold text-zinc-400 tabular-nums">{player.dorsal}</Text>
        ) : null}
        <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {name}
        </Text>
        {draft.isMvp ? (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: `${accent}1a` }}>
            <Text className="text-[10px] font-bold" style={{ color: accent }}>
              MVP
            </Text>
          </View>
        ) : null}
      </View>

      {/* Stats consolidadas = CONTEXTO de solo lectura (no valoración). */}
      {s ? (
        <View className="flex-row flex-wrap gap-x-3 gap-y-0.5">
          <Stat label={t('post_partido.stat_min')} value={`${s.minutesPlayed}'`} />
          {s.goals > 0 ? <Stat label={t('post_partido.stat_goals')} value={String(s.goals)} /> : null}
          {s.assists > 0 ? <Stat label={t('post_partido.stat_assists')} value={String(s.assists)} /> : null}
          {s.shots > 0 ? <Stat label={t('post_partido.stat_shots')} value={String(s.shots)} /> : null}
          {s.yellowCards > 0 ? <Stat label="🟨" value={String(s.yellowCards)} /> : null}
          {s.redCards > 0 ? <Stat label="🟥" value={String(s.redCards)} /> : null}
          {s.started ? <Stat label={t('post_partido.stat_starter')} value="✓" /> : null}
        </View>
      ) : (
        <Text className="text-[11px] text-zinc-400">{t('post_partido.no_stats')}</Text>
      )}

      <RatingScale
        value={draft.rating}
        accent={accent}
        disabled={!editable}
        onPick={(n) => onSetDraft({ rating: draft.rating === n ? null : n })}
      />

      <TextInput
        value={draft.comment}
        onChangeText={(v) => onSetDraft({ comment: v })}
        editable={editable}
        placeholder={t('post_partido.comment_ph')}
        multiline
        className="min-h-[40px] rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
      />

      <View className="flex-row items-center gap-2">
        <Pressable
          disabled={!editable}
          onPress={() => onSetDraft({ isMvp: !draft.isMvp })}
          className="rounded-lg px-3 py-2 active:opacity-70"
          style={{
            borderWidth: 1.5,
            borderColor: draft.isMvp ? accent : '#e4e4e7',
            backgroundColor: draft.isMvp ? `${accent}14` : undefined,
            opacity: editable ? 1 : 0.4,
          }}
        >
          <Text className="text-xs font-semibold text-[#0F1B2E]">{t('post_partido.mvp')}</Text>
        </Pressable>
        <View className="flex-1" />
        {hasEval ? (
          <Btn
            label={t('post_partido.clear')}
            accent={accent}
            disabled={!editable}
            onPress={onRemove}
          />
        ) : null}
        <Btn
          label={saving ? t('post_partido.saving') : t('post_partido.save')}
          accent={accent}
          disabled={!editable || draft.rating == null}
          onPress={onSave}
          primary
        />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Text className="text-[11px] text-zinc-500">
      <Text className="text-zinc-400">{label} </Text>
      <Text className="font-semibold text-[#0F1B2E] tabular-nums">{value}</Text>
    </Text>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="rounded-xl bg-zinc-100 px-4 py-2">
      <Text className="text-center text-xs text-zinc-500">{text}</Text>
    </View>
  );
}

function Btn({
  label,
  accent,
  disabled,
  onPress,
  primary,
}: {
  label: string;
  accent: string;
  disabled: boolean;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className="rounded-xl px-4 py-2.5 active:opacity-70"
      style={{
        backgroundColor: primary ? accent : undefined,
        borderWidth: primary ? 0 : 1,
        borderColor: '#e4e4e7',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text className={`text-center text-sm font-semibold ${primary ? 'text-white' : 'text-[#0F1B2E]'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Botón destructivo en dos pasos (reabrir partido), como el reloj de 9a. */
function ConfirmBtn({
  label,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
      className="rounded-xl px-4 py-2.5 active:opacity-70"
      style={{
        borderWidth: 1,
        borderColor: armed ? '#dc2626' : '#e4e4e7',
        backgroundColor: armed ? 'rgba(220,38,38,0.08)' : undefined,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text className={`text-center text-sm font-semibold ${armed ? 'text-red-600' : 'text-[#0F1B2E]'}`}>
        {armed ? confirmLabel : label}
      </Text>
    </Pressable>
  );
}
