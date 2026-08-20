import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  canRecommend,
  isRecommendedExercise,
  type PickableExercise,
  type SessionBlockType,
} from '@misterfc/core';
import { useTranslations } from '@/locale/provider';

/**
 * G2 — Hoja inferior para AÑADIR un ejercicio a un bloque de la sesión (nativo).
 * Replica el criterio y el orden del picker de la web (`exercise-picker.tsx`): al
 * abrir muestra DIRECTAMENTE los RECOMENDADOS para la fase del bloque + la categoría
 * del equipo + los objetivos de la sesión (regla fase-aware `isRecommendedExercise`),
 * con un buscador por nombre y un "Ver todos" discreto que amplía al catálogo
 * completo del club. Filtra en cliente (set por club modesto). Tope 50, como la web.
 *
 * Los objetivos llegan del ESTADO VIVO de la cabecera (no del snapshot cargado): si el
 * entrenador cambia los objetivos, los recomendados se recalculan al reabrir la hoja.
 */
export function ExercisePickerSheet({
  visible,
  exercises,
  phase,
  category,
  tactical,
  technical,
  accent,
  onPick,
  onClose,
}: {
  visible: boolean;
  exercises: PickableExercise[];
  phase: SessionBlockType;
  category: string | null;
  tactical: string[];
  technical: string[];
  accent: string;
  onPick: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Criterio del BLOQUE (12.7a): fase + categoría del equipo + objetivos de la sesión.
  const criteria = useMemo(
    () => ({ phase, category, tactical, technical }),
    [phase, category, tactical, technical],
  );
  const recommendable = canRecommend(criteria);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises
      .filter((e) => {
        if (needle && !e.name.toLowerCase().includes(needle)) return false;
        // Por defecto SOLO recomendados (si hay criterio); "Ver todos" lo amplía.
        if (!showAll && recommendable && !isRecommendedExercise(e, criteria)) return false;
        return true;
      })
      .slice(0, 50);
  }, [exercises, q, showAll, recommendable, criteria]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable className="rounded-t-3xl bg-white px-4 pb-8 pt-4" onPress={() => {}}>
          <Text className="mb-3 text-base font-bold text-[#0F1B2E]">
            {t('sesiones.picker.add')}
          </Text>

          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('sesiones.picker.search')}
            placeholderTextColor="#a1a1aa"
            autoFocus
            className="mb-2 rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
          />

          {filtered.length === 0 ? (
            <View className="items-center gap-2 py-6">
              <Text className="text-sm text-zinc-400">{t('sesiones.picker.empty')}</Text>
              {!showAll && recommendable ? (
                <Pressable onPress={() => setShowAll(true)} className="active:opacity-60">
                  <Text className="text-sm font-medium" style={{ color: accent }}>
                    {t('sesiones.picker.show_all')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {filtered.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => {
                    onPick(e.id, e.name);
                    onClose();
                  }}
                  className="border-b border-zinc-100 py-3 active:opacity-60"
                >
                  <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
                    {e.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* "Ver todos" / "Ver recomendados" discreto: solo si hay recomendación activa. */}
          {recommendable ? (
            <Pressable
              onPress={() => setShowAll((v) => !v)}
              className="mt-3 self-center active:opacity-60"
            >
              <Text className="text-xs text-zinc-500">
                {showAll ? t('sesiones.picker.show_recommended') : t('sesiones.picker.show_all')}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
