import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  getAnnouncementsListFromClient,
  markNotificationsReadFromClient,
  clubScopedCacheKey,
  type AnnouncementRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { OfflineBanner, EmptyState, LoadingScreen } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/** Cuántos anuncios se muestran en la parte "Últimos"; el resto va al histórico. */
const RECENT_COUNT = 10;

/**
 * O2-5 B1 — Anuncios: lista club-wide + equipos del hijo (RLS). Caché club-scoped
 * (clubId en la key). Marca leídos los `new_announcement` al abrir. Punto 7 QA:
 * dos partes (patrón de Entrenamientos) — los 10 últimos arriba y el histórico
 * debajo. El "leído" es el mismo mecanismo de siempre (no se toca aquí).
 */
export function AnunciosScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<AnnouncementRow[]>(
    clubScopedCacheKey('anuncios', clubId ?? 'none'),
    (sb) =>
      clubId ? getAnnouncementsListFromClient(sb, clubId) : Promise.resolve([]),
  );

  useEffect(() => {
    void markNotificationsReadFromClient(supabase, [
      'new_announcement',
    ] as ('new_announcement')[]).then(() => {
      // Al leer los anuncios cae el contador del inicio y su sección de no leídos.
      void invalidateAfterWrite('markNotifications');
    });
  }, []);

  if (loading) return <LoadingScreen />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState message={t('anuncios.empty')} />;

  // `getAnnouncementsListFromClient` ordena fijados primero y luego por recencia;
  // los 10 primeros son "los últimos" y el resto el histórico (mismo orden).
  const recent = rows.slice(0, RECENT_COUNT);
  const history = rows.slice(RECENT_COUNT);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader title={t('anuncios.section_recent')} />
        {recent.map((item) => (
          <AnnouncementRowView key={item.id} item={item} fallback={t('nav.anuncios')} />
        ))}

        {history.length > 0 ? (
          <>
            <SectionHeader title={t('anuncios.section_history')} />
            {history.map((item) => (
              <AnnouncementRowView key={item.id} item={item} fallback={t('nav.anuncios')} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {title}
    </Text>
  );
}

function AnnouncementRowView({
  item,
  fallback,
}: {
  item: AnnouncementRow;
  fallback: string;
}) {
  return (
    <View className="border-b border-zinc-100 px-4 py-3">
      <View className="flex-row items-center gap-2">
        {item.pinned ? <Text className="text-amber-500">📌</Text> : null}
        <Text className="flex-1 text-base font-semibold text-[#0F1B2E]">
          {item.title}
        </Text>
      </View>
      <Text className="mt-1 text-sm text-zinc-600" numberOfLines={3}>
        {item.body}
      </Text>
      <Text className="mt-1 text-xs text-zinc-400">
        {(item.teamName ?? fallback) + ' · ' + item.created_at.slice(0, 10)}
      </Text>
    </View>
  );
}
