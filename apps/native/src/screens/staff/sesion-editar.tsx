import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import {
  getSessionForEditFromClient,
  getPickableExercisesFromClient,
  updateSessionHeaderFromClient,
  setSessionSharedFromClient,
  addBlockTaskFromClient,
  removeBlockTaskFromClient,
  reorderTasksFromClient,
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  eventScopedCacheKey,
  clubScopedCacheKey,
  type SessionForEdit,
  type SessionBlockForEdit,
  type PickableExercise,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { ExercisePickerSheet } from '@/ui/exercise-picker-sheet';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * G1+G2 — Editor de sesión de entrenamiento (staff). UNA pantalla con secciones:
 * cabecera (nombre + objetivos tácticos/técnicos + objetivo físico), interruptor de
 * COMPARTIR (#484: solo si está asignada, que aquí siempre lo está) y las 5 PARTES en
 * orden, ahora EDITABLES (G2): añadir ejercicios (picker con recomendados por
 * fase+categoría+objetivos y "ver todos"), quitarlos y reordenarlos con flechas
 * arriba/abajo (el drag en una lista dentro del ScrollView entra en conflicto de
 * gestos; las flechas son el patrón que la propia web usa en su sub-lista de jugadas).
 * Guardado POR CAMPO (cabecera) y por acción (bloques). NO edita meso/microciclo (no
 * se pisan). Fetch/escritura en core; RLS = gate. Las jugadas del bloque se muestran en
 * SOLO LECTURA (su picker queda fuera de alcance en esta tanda).
 */
export function SesionEditarScreen({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<SessionForEdit | null>(
    eventScopedCacheKey('sesion-editar', sessionId ?? 'none'),
    (sb) =>
      clubId && sessionId
        ? getSessionForEditFromClient(sb, clubId, sessionId)
        : Promise.resolve(null),
  );

  if (!sessionId) return <EmptyState message={t('sesiones.errors.not_found')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('sesiones.errors.not_found')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      {/* La clave del editor arranca el estado local desde los datos cargados: se monta
          cuando ya hay sesión, así los campos no necesitan re-sincronizarse. */}
      <EditorBody key={data.id} session={data} />
    </View>
  );
}

function EditorBody({ session }: { session: SessionForEdit }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const accent = theme?.color ?? BRAND.navy;
  const clubId = activeClub?.club.id ?? null;

  const [title, setTitle] = useState(session.title ?? '');
  const [physical, setPhysical] = useState(session.objective_physical ?? '');
  const [tactical, setTactical] = useState<string[]>(session.tactical_objectives);
  const [technical, setTechnical] = useState<string[]>(session.technical_objectives);
  const [shared, setShared] = useState(session.visibility === 'team');
  const [savingShare, setSavingShare] = useState(false);

  // Bloques como fuente durante la edición: las mutaciones optimistas actualizan aquí
  // y persisten en segundo plano (revierten con el snapshot si fallan).
  const [blocks, setBlocks] = useState<SessionBlockForEdit[]>(session.blocks);
  const [pickerFor, setPickerFor] = useState<string | null>(null); // id del bloque

  // Catálogo del club para el picker (recomendación fase-aware en cliente).
  const { data: pickable } = useCached<PickableExercise[]>(
    clubScopedCacheKey('session-pickable', clubId ?? 'none'),
    (sb) => (clubId ? getPickableExercisesFromClient(sb, clubId) : Promise.resolve([])),
  );

  // Compartir solo si está asignada a un entrenamiento y tiene equipo (#484).
  const canShare = session.team_id != null && session.event_id != null;

  // Guardado POR CAMPO: escribe SOLO nombre + objetivos (meso/micro intactos).
  const saveHeader = useCallback(
    (next: { title?: string; physical?: string; tactical?: string[]; technical?: string[] }) => {
      void updateSessionHeaderFromClient(supabase, {
        id: session.id,
        title: next.title ?? title,
        objective_physical: next.physical ?? physical,
        tactical_objectives: next.tactical ?? tactical,
        technical_objectives: next.technical ?? technical,
      }).then(() => invalidateAfterWrite('sessionEdit'));
    },
    [session.id, title, physical, tactical, technical],
  );

  const toggleTactical = (v: string) => {
    const nextArr = tactical.includes(v) ? tactical.filter((x) => x !== v) : [...tactical, v];
    setTactical(nextArr);
    saveHeader({ tactical: nextArr });
  };
  const toggleTechnical = (v: string) => {
    const nextArr = technical.includes(v) ? technical.filter((x) => x !== v) : [...technical, v];
    setTechnical(nextArr);
    saveHeader({ technical: nextArr });
  };

  const onToggleShare = (nextVal: boolean) => {
    setShared(nextVal); // optimista
    setSavingShare(true);
    void setSessionSharedFromClient(supabase, session.id, nextVal).then((r) => {
      setSavingShare(false);
      if (!r.ok) {
        setShared(!nextVal); // revierte
        return;
      }
      void invalidateAfterWrite('sessionEdit');
    });
  };

  // ── Mutaciones de tareas (G2) ──
  const addTask = (blockId: string, exerciseId: string, name: string) => {
    // Se añade TRAS el éxito (usamos el id devuelto), como la web.
    void addBlockTaskFromClient(supabase, { block_id: blockId, exercise_id: exerciseId }).then(
      (res) => {
        if (!res.id) return;
        const newId = res.id;
        setBlocks((prev) =>
          prev.map((b) =>
            b.id !== blockId
              ? b
              : {
                  ...b,
                  tasks: [
                    ...b.tasks,
                    {
                      id: newId,
                      exercise_id: exerciseId,
                      exercise_name: name,
                      order_idx: b.tasks.length,
                      duration_min: null,
                      series: null,
                      notes: null,
                    },
                  ],
                },
          ),
        );
        void invalidateAfterWrite('sessionEdit');
      },
    );
  };

  const removeTask = (blockId: string, taskId: string) => {
    const snapshot = blocks;
    setBlocks((prev) =>
      prev.map((b) => (b.id !== blockId ? b : { ...b, tasks: b.tasks.filter((x) => x.id !== taskId) })),
    );
    void removeBlockTaskFromClient(supabase, { id: taskId }).then((r) => {
      if (!r.ok) {
        setBlocks(snapshot); // revierte
        return;
      }
      void invalidateAfterWrite('sessionEdit');
    });
  };

  const moveTask = (blockId: string, taskId: string, dir: -1 | 1) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const ids = block.tasks.map((x) => x.id);
    const from = ids.indexOf(taskId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const newIds = [...ids];
    [newIds[from], newIds[to]] = [newIds[to], newIds[from]];
    const snapshot = blocks;
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId ? b : { ...b, tasks: newIds.map((id) => b.tasks.find((x) => x.id === id)!) },
      ),
    );
    void reorderTasksFromClient(supabase, { block_id: blockId, task_ids: newIds }).then((r) => {
      if (!r.ok) {
        setBlocks(snapshot); // revierte
        return;
      }
      void invalidateAfterWrite('sessionEdit');
    });
  };

  const pickerBlock = pickerFor ? blocks.find((b) => b.id === pickerFor) ?? null : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      <Text className="text-xl font-bold text-[#0F1B2E]">{t('sesiones.edit_title')}</Text>

      {/* ── Cabecera: nombre ── */}
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('sesiones.fields.title')}
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => saveHeader({})}
          placeholder={t('sesiones.placeholders.title')}
          placeholderTextColor="#a1a1aa"
          maxLength={120}
          className="rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
        />
      </View>

      {/* ── Objetivos tácticos (multiselección de chips) ── */}
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('sesiones.fields.tactical')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {TACTICAL_OBJECTIVES.map((v) => (
            <Chip
              key={v}
              label={t(`ejercicios.tactical.${v}`)}
              active={tactical.includes(v)}
              accent={accent}
              onPress={() => toggleTactical(v)}
            />
          ))}
        </View>
      </View>

      {/* ── Objetivos técnicos ── */}
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('sesiones.fields.technical')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {TECHNICAL_OBJECTIVES.map((v) => (
            <Chip
              key={v}
              label={t(`ejercicios.technical.${v}`)}
              active={technical.includes(v)}
              accent={accent}
              onPress={() => toggleTechnical(v)}
            />
          ))}
        </View>
      </View>

      {/* ── Objetivo físico (texto libre) ── */}
      <View className="gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('sesiones.fields.objective_physical')}
        </Text>
        <TextInput
          value={physical}
          onChangeText={setPhysical}
          onBlur={() => saveHeader({})}
          multiline
          maxLength={2000}
          className="min-h-16 rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
        />
      </View>

      {/* ── Compartir (#484) ── */}
      <View
        className="rounded-2xl border border-zinc-200 p-4"
        style={{ borderLeftWidth: 4, borderLeftColor: accent }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]">
            {t('sesiones.publish.label')}
          </Text>
          <Switch value={shared} onValueChange={onToggleShare} disabled={savingShare || !canShare} />
        </View>
        <Text className="mt-1 text-xs text-zinc-500">
          {!canShare
            ? t('sesiones.publish.no_event')
            : shared
              ? t('sesiones.publish.help_published')
              : t('sesiones.publish.help_draft')}
        </Text>
      </View>

      {/* ── Las 5 partes (editables, G2) ── */}
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('sesiones.sections.blocks')}
        </Text>
        {blocks.map((block) => (
          <View key={block.id} className="rounded-2xl border border-zinc-200 p-4">
            <Text className="mb-2 text-sm font-semibold text-[#0F1B2E]">
              {block.title ?? t(`sesiones.block_types.${block.block_type}`)}
            </Text>

            {block.tasks.length === 0 ? (
              <Text className="mb-2 text-sm text-zinc-400">{t('sesiones.block_empty')}</Text>
            ) : (
              block.tasks.map((task, i) => (
                <View
                  key={task.id}
                  className="flex-row items-center gap-2 border-b border-zinc-100 py-2"
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                      {task.exercise_name}
                    </Text>
                    {task.duration_min != null || task.series ? (
                      <Text className="text-xs text-zinc-400">
                        {[
                          task.duration_min != null
                            ? t('sesiones.templates.minutes', { count: String(task.duration_min) })
                            : null,
                          task.series,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  {/* Reordenar con flechas (↑/↓) — deshabilitadas en los extremos. */}
                  <IconBtn
                    label={t('sesiones.blocks.move_up')}
                    glyph="↑"
                    disabled={i === 0}
                    onPress={() => moveTask(block.id, task.id, -1)}
                  />
                  <IconBtn
                    label={t('sesiones.blocks.move_down')}
                    glyph="↓"
                    disabled={i === block.tasks.length - 1}
                    onPress={() => moveTask(block.id, task.id, 1)}
                  />
                  <IconBtn
                    label={t('sesiones.blocks.remove')}
                    glyph="✕"
                    danger
                    onPress={() => removeTask(block.id, task.id)}
                  />
                </View>
              ))
            )}

            {/* Jugadas del bloque: SOLO LECTURA (picker fuera de alcance). */}
            {block.plays.length > 0 ? (
              <View className="mt-2 border-t border-zinc-100 pt-2">
                {block.plays.map((play) => (
                  <Text key={play.id} className="py-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                    {play.play_name || t('playbook.untitled')}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* Añadir ejercicio → abre el picker con la fase de ESTE bloque. */}
            <Pressable
              onPress={() => setPickerFor(block.id)}
              className="mt-2 self-start rounded-full border px-3 py-1.5 active:opacity-70"
              style={{ borderColor: accent }}
            >
              <Text className="text-xs font-semibold" style={{ color: accent }}>
                + {t('sesiones.picker.add')}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* Picker (uno; su fase/criterio = el bloque abierto). Objetivos VIVOS: si cambian
          en la cabecera, los recomendados se recalculan al reabrir. */}
      {pickerBlock ? (
        <ExercisePickerSheet
          visible
          exercises={pickable ?? []}
          phase={pickerBlock.block_type}
          category={session.team_category_kind}
          tactical={tactical}
          technical={technical}
          accent={accent}
          onPick={(id, name) => addTask(pickerBlock.id, id, name)}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full border px-3 py-1.5 active:opacity-70"
      style={{
        borderColor: active ? accent : '#e4e4e7',
        backgroundColor: active ? accent : 'transparent',
      }}
    >
      <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-[#0F1B2E]'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconBtn({
  label,
  glyph,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={8}
      className="h-7 w-7 items-center justify-center rounded-full active:opacity-60"
      style={{ opacity: disabled ? 0.3 : 1 }}
    >
      <Text className={`text-base ${danger ? 'text-red-500' : 'text-zinc-500'}`}>{glyph}</Text>
    </Pressable>
  );
}
