import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getEventSessionIdFromClient,
  getSessionTemplatesFromClient,
  planSessionForEventFromClient,
  clubScopedCacheKey,
  eventScopedCacheKey,
  type SessionTemplateRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * G1 — Entrada a la sesión de un ENTRENAMIENTO (staff). Si el entrenamiento no tiene
 * sesión, ofrece "Planificar sesión" → una hoja inferior de origen (En blanco | Desde
 * plantilla) que la crea SIEMPRE asignada (camino "plan", hereda equipo/fecha del
 * evento) y navega al editor. Si ya la tiene, ofrece "Abrir sesión". Toda la
 * orquestación vive en core; RLS = gate (desde #477 todo el cuerpo técnico puede crear).
 */
export function SessionPlanEntry({ eventId }: { eventId: string | null }) {
  const t = useTranslations('');
  const router = useRouter();
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data: sessionId, loading } = useCached<string | null>(
    eventScopedCacheKey('event-session', eventId ?? 'none'),
    (sb) => (eventId ? getEventSessionIdFromClient(sb, eventId) : Promise.resolve(null)),
  );

  const { data: templates } = useCached<SessionTemplateRow[]>(
    clubScopedCacheKey('session-templates', clubId ?? 'none'),
    (sb) => (clubId ? getSessionTemplatesFromClient(sb, clubId) : Promise.resolve([])),
  );

  if (!eventId || loading) return null;

  const openEditor = (id: string) =>
    router.push({ pathname: '/staff/sesion-editar', params: { sessionId: id } });

  const create = (templateId: string | null) => {
    if (!clubId || creating) return;
    setCreating(true);
    void planSessionForEventFromClient(supabase, { clubId, eventId, templateId }).then((res) => {
      setCreating(false);
      setSheetOpen(false);
      if (res.id) {
        void invalidateAfterWrite('planSession');
        openEditor(res.id);
      }
    });
  };

  return (
    <View className="px-4 pb-1 pt-2">
      <Pressable
        onPress={() => (sessionId ? openEditor(sessionId) : setSheetOpen(true))}
        className="flex-row items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3 active:opacity-70"
        style={{ borderLeftWidth: 4, borderLeftColor: accent }}
      >
        <Text className="text-sm font-semibold text-[#0F1B2E]">
          {sessionId ? t('calendario.dialog.plan.open_session') : t('calendario.dialog.plan.trigger')}
        </Text>
        <Text className="text-lg">📋</Text>
      </Pressable>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setSheetOpen(false)}>
          <Pressable className="rounded-t-3xl bg-white px-4 pb-8 pt-4" onPress={() => {}}>
            <Text className="mb-3 text-base font-bold text-[#0F1B2E]">
              {t('sesiones.templates.start_from')}
            </Text>

            {/* En blanco (siembra el esqueleto estándar). */}
            <Pressable
              onPress={() => create(null)}
              disabled={creating}
              className="mb-2 rounded-2xl border border-zinc-200 px-4 py-3 active:opacity-70"
              style={{ opacity: creating ? 0.5 : 1 }}
            >
              <Text className="text-sm font-semibold text-[#0F1B2E]">
                {t('sesiones.templates.mode_blank')}
              </Text>
            </Pressable>

            {/* Desde plantilla. */}
            <Text className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('sesiones.templates.mode_template')}
            </Text>
            {(templates ?? []).length === 0 ? (
              <Text className="py-2 text-sm text-zinc-400">{t('sesiones.templates.empty')}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {(templates ?? []).map((tpl) => (
                  <Pressable
                    key={tpl.id}
                    onPress={() => create(tpl.id)}
                    disabled={creating}
                    className="border-b border-zinc-100 py-3 active:opacity-60"
                  >
                    <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
                      {tpl.title ?? t('sesiones.templates.untitled')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {creating ? (
              <View className="mt-3 flex-row items-center justify-center gap-2 py-1">
                <ActivityIndicator size="small" color={accent} />
              </View>
            ) : (
              <Pressable onPress={() => setSheetOpen(false)} className="mt-3 py-2 active:opacity-60">
                <Text className="text-center text-sm text-zinc-500">
                  {t('sesiones.templates.cancel')}
                </Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
