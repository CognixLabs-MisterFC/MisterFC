import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getTeamAnnouncementsFromClient,
  updateAnnouncementFromClient,
  deleteAnnouncementFromClient,
  teamScopedCacheKey,
  type TeamAnnouncementRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t, APP_LOCALE } from '@/i18n';
import { BRAND } from '@/theme';
import { MisEquiposScreen } from './mis-equipos';

/**
 * O2-10b-1b — Anuncios de un equipo (staff). Lista + publicar + editar/borrar.
 * PUBLICAR pasa por el route handler `/api/announcements/publish` (Bearer): insert
 * como el usuario (RLS = gate) + fan-out service-role DESPUÉS. EDITAR/BORRAR son
 * escritura directa RLS (sin fan-out — solo publicar notifica). Sin teamId → picker
 * (MisEquiposScreen target="anuncios"). Write-guard: publicar/editar/borrar exigen
 * red; leer offline desde caché. El candado real es la BD (RLS).
 */
export function TeamAnnouncementsScreen({
  teamId,
  name,
}: {
  teamId: string | null;
  name: string | null;
}) {
  const { activeClub, theme } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<TeamAnnouncementRow[]>(
    teamScopedCacheKey('staff-anuncios', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamAnnouncementsFromClient(sb, teamId) : Promise.resolve([])),
  );

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setTitle('');
    setBody('');
    setPinned(false);
    setEditingId(null);
    setError(null);
  }, []);

  const startEdit = useCallback((a: TeamAnnouncementRow) => {
    setEditingId(a.id);
    setTitle(a.title);
    setBody(a.body);
    setPinned(a.pinned);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    const tt = title.trim();
    const bb = body.trim();
    if (!online || busy || !teamId || tt.length === 0 || bb.length === 0) return; // write-guard
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        // Editar: RLS directa, sin fan-out.
        const res = await updateAnnouncementFromClient(supabase, editingId, {
          title: tt,
          body: bb,
          pinned,
        });
        if ('error' in res) {
          setError(t('anuncios_staff.save_error'));
          setBusy(false);
          return;
        }
      } else {
        // Publicar: route handler (insert como usuario + fan-out service-role después).
        const r = await callServerEndpoint('/api/announcements/publish', {
          method: 'POST',
          body: { teamId, title: tt, body: bb, pinned, locale: APP_LOCALE },
        });
        if (!r.ok) {
          setError(t('anuncios_staff.publish_error'));
          setBusy(false);
          return;
        }
      }
      setBusy(false);
      resetForm();
      refresh();
    } catch {
      setError(t('anuncios_staff.publish_error'));
      setBusy(false);
    }
  }, [title, body, pinned, online, busy, teamId, editingId, resetForm, refresh]);

  const confirmDelete = useCallback(
    (a: TeamAnnouncementRow) => {
      if (!online) return; // write-guard
      Alert.alert(t('anuncios_staff.delete_title'), a.title, [
        { text: t('anuncios_staff.cancel'), style: 'cancel' },
        {
          text: t('anuncios_staff.delete'),
          style: 'destructive',
          onPress: async () => {
            const res = await deleteAnnouncementFromClient(supabase, a.id);
            if ('error' in res) {
              setError(t('anuncios_staff.delete_error'));
              return;
            }
            if (editingId === a.id) resetForm();
            refresh();
          },
        },
      ]);
    },
    [online, editingId, resetForm, refresh],
  );

  if (!teamId) return <MisEquiposScreen target="anuncios" />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  const canSubmit = online && !busy && title.trim().length > 0 && body.trim().length > 0;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{name ?? t('anuncios_staff.title')}</ScreenTitle>

        {/* Formulario: publicar (o guardar edición). */}
        <View className="gap-2 rounded-2xl border border-zinc-200 p-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {editingId ? t('anuncios_staff.edit') : t('anuncios_staff.new')}
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('anuncios_staff.title_ph')}
            placeholderTextColor="#a1a1aa"
            editable={online && !busy}
            maxLength={120}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={t('anuncios_staff.body_ph')}
            placeholderTextColor="#a1a1aa"
            editable={online && !busy}
            multiline
            maxLength={2000}
            className="max-h-40 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
          />
          <Pressable
            onPress={() => setPinned((v) => !v)}
            className="flex-row items-center gap-2 py-1 active:opacity-70"
          >
            <View
              className="h-5 w-5 items-center justify-center rounded border"
              style={{ borderColor: pinned ? accent : '#D4D4D8', backgroundColor: pinned ? accent : '#FFF' }}
            >
              {pinned ? <Text className="text-xs text-white">✓</Text> : null}
            </View>
            <Text className="text-sm text-[#0F1B2E]">📌 {t('anuncios_staff.pinned')}</Text>
          </Pressable>

          {!online ? (
            <Text className="text-xs text-zinc-400">{t('anuncios_staff.offline')}</Text>
          ) : null}
          {error ? <Text className="text-xs text-red-600">{error}</Text> : null}

          <View className="flex-row gap-2">
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              className="flex-1 items-center rounded-full px-4 py-2.5 active:opacity-80"
              style={{ backgroundColor: accent, opacity: canSubmit ? 1 : 0.5 }}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">
                  {editingId ? t('anuncios_staff.save') : t('anuncios_staff.publish')}
                </Text>
              )}
            </Pressable>
            {editingId ? (
              <Pressable
                onPress={resetForm}
                disabled={busy}
                className="items-center rounded-full border border-zinc-200 px-4 py-2.5 active:opacity-70"
              >
                <Text className="text-sm font-medium text-zinc-600">
                  {t('anuncios_staff.cancel')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Lista. */}
        {rows.length === 0 ? (
          <EmptyState message={t('anuncios_staff.empty')} />
        ) : (
          rows.map((a) => (
            <View key={a.id} className="gap-1 rounded-2xl border border-zinc-200 p-3">
              <View className="flex-row items-center gap-2">
                {a.pinned ? <Text className="text-amber-500">📌</Text> : null}
                <Text className="flex-1 text-base font-semibold text-[#0F1B2E]">{a.title}</Text>
              </View>
              <Text className="text-sm text-zinc-600">{a.body}</Text>
              <Text className="text-xs text-zinc-400">
                {(a.authorName ?? '—') + ' · ' + a.created_at.slice(0, 10)}
              </Text>
              <View className="mt-1 flex-row gap-4">
                <Pressable
                  onPress={() => startEdit(a)}
                  disabled={!online}
                  className="active:opacity-60"
                  style={{ opacity: online ? 1 : 0.4 }}
                >
                  <Text className="text-xs font-medium" style={{ color: accent }}>
                    {t('anuncios_staff.edit')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(a)}
                  disabled={!online}
                  className="active:opacity-60"
                  style={{ opacity: online ? 1 : 0.4 }}
                >
                  <Text className="text-xs font-medium text-red-600">
                    {t('anuncios_staff.delete')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
