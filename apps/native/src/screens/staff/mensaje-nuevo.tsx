import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  startConversationFromClient,
  createTeamConversationFromClient,
  startStaffConversationFromClient,
  listMessageablePlayersFromClient,
  listMessageableTeamsFromClient,
  listStaffDirectoryFromClient,
  formatPlayerName,
  type MessageablePlayer,
  type MessageableTeam,
  type StaffDirectoryEntry,
  type StaffDirectoryRole,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

type Mode = 'player' | 'team' | 'club';

/** Orden de las secciones del directorio de staff (mismo criterio que core). */
const STAFF_ROLE_ORDER: StaffDirectoryRole[] = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
];

/**
 * O2-10b-1a / O2-12 — "Nueva conversación" del STAFF (lo que la familia NO tiene).
 * Elige un JUGADOR (1:1 con familia), un EQUIPO (grupo) o un miembro del CLUB (staff,
 * O2-12) y abre/crea el hilo con los helpers de core (`startConversationFromClient` /
 * `createTeamConversationFromClient` / `startStaffConversationFromClient`) — INSERT como
 * el usuario, la RLS es el gate (42501 → forbidden). El directorio de staff ya excluye
 * al propio y deriva el conjunto como la RLS. Tras abrir el hilo navega a su pantalla;
 * el envío reutiliza el endpoint F3. Write-guard: crear exige red; offline → aviso.
 */
export function MensajeNuevoScreen({ basePath = '/staff' }: { basePath?: string }) {
  const t = useTranslations('');
  const { user } = useSession();
  const { activeClub, theme } = useApp();
  const router = useRouter();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const role = activeClub?.role ?? null;
  const userId = user?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [mode, setMode] = useState<Mode>('player');
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<MessageablePlayer[]>([]);
  const [teams, setTeams] = useState<MessageableTeam[]>([]);
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carga de destinatarios (online): jugadores + equipos que el usuario puede
  // mensajear. La RLS los acota; el buscador filtra en cliente.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!clubId || !membershipId) {
        setLoading(false);
        return;
      }
      const isAdminDir = role === 'admin_club' || role === 'director';
      const [pRes, tRes, sRes] = await Promise.all([
        listMessageablePlayersFromClient(supabase, clubId),
        listMessageableTeamsFromClient(supabase, { clubId, isAdminDir, membershipId }),
        userId
          ? listStaffDirectoryFromClient(supabase, { clubId, currentProfileId: userId })
          : Promise.resolve({ staff: [] as StaffDirectoryEntry[] }),
      ]);
      if (!active) return;
      if ('players' in pRes) setPlayers(pRes.players);
      if ('teams' in tRes) setTeams(tRes.teams);
      if ('staff' in sRes) setStaff(sRes.staff);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [clubId, membershipId, role, userId]);

  const openPlayer = useCallback(
    async (p: MessageablePlayer) => {
      if (!online || !clubId || !userId || busyId) return; // write-guard
      setBusyId(p.id);
      setError(null);
      const res = await startConversationFromClient(supabase, {
        clubId,
        playerId: p.id,
        coachProfileId: userId,
      });
      setBusyId(null);
      if ('error' in res) {
        setError(t('mensajes_staff.create_error'));
        return;
      }
      void invalidateAfterWrite('createConversation');
      router.replace({
        pathname: `${basePath}/mensaje`,
        params: {
          conversationId: res.ok.conversationId,
          title: formatPlayerName(p.first_name, p.last_name),
        },
      });
    },
    [online, clubId, userId, busyId, router, basePath, t],
  );

  const openTeam = useCallback(
    async (team: MessageableTeam) => {
      if (!online || !clubId || busyId) return; // write-guard
      setBusyId(team.id);
      setError(null);
      const res = await createTeamConversationFromClient(supabase, {
        clubId,
        teamId: team.id,
      });
      setBusyId(null);
      if ('error' in res) {
        setError(t('mensajes_staff.create_error'));
        return;
      }
      void invalidateAfterWrite('createConversation');
      router.replace({
        pathname: `${basePath}/mensaje-equipo`,
        params: { teamConversationId: res.ok.conversationId, title: team.name },
      });
    },
    [online, clubId, busyId, router, basePath, t],
  );

  const openStaff = useCallback(
    async (entry: StaffDirectoryEntry) => {
      if (!online || !clubId || !userId || busyId) return; // write-guard
      setBusyId(entry.profileId);
      setError(null);
      const res = await startStaffConversationFromClient(supabase, {
        clubId,
        currentProfileId: userId,
        otherProfileId: entry.profileId,
      });
      setBusyId(null);
      if ('error' in res) {
        setError(t('mensajes_staff.create_error'));
        return;
      }
      void invalidateAfterWrite('createConversation');
      router.replace({
        pathname: `${basePath}/mensaje-staff`,
        params: { conversationId: res.ok.conversationId, title: entry.fullName },
      });
    },
    [online, clubId, userId, busyId, router, basePath, t],
  );

  if (loading) return <LoadingScreen />;

  const term = query.trim().toLowerCase();
  const filteredPlayers = term
    ? players.filter((p) =>
        formatPlayerName(p.first_name, p.last_name).toLowerCase().includes(term),
      )
    : players;
  const filteredTeams = term
    ? teams.filter((t2) => t2.name.toLowerCase().includes(term))
    : teams;
  const filteredStaff = term
    ? staff.filter((s) => s.fullName.toLowerCase().includes(term))
    : staff;
  // Secciones del directorio de staff: por rol (orden fijo), solo las no vacías.
  const staffSections = STAFF_ROLE_ORDER.map((r) => ({
    role: r,
    data: filteredStaff.filter((s) => s.role === r),
  })).filter((sec) => sec.data.length > 0);

  return (
    <View className="flex-1 bg-white">
      <View className="px-4 pt-4">
        <ScreenTitle>{t('mensajes_staff.new_title')}</ScreenTitle>
      </View>

      {/* Selector de modo: Jugador (1:1 familia) / Equipo (grupo) / Club (staff). */}
      <View className="flex-row gap-2 px-4 pb-2 pt-1">
        <Segment label={t('mensajes_staff.tab_player')} active={mode === 'player'} accent={accent} onPress={() => setMode('player')} />
        <Segment label={t('mensajes_staff.tab_team')} active={mode === 'team'} accent={accent} onPress={() => setMode('team')} />
        <Segment label={t('mensajes_staff.tab_club')} active={mode === 'club'} accent={accent} onPress={() => setMode('club')} />
      </View>

      <View className="px-4 pb-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('mensajes_staff.search')}
          placeholderTextColor="#a1a1aa"
          className="rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
        />
      </View>

      {!online ? (
        <Text className="px-4 pb-1 text-xs text-zinc-400">{t('mensajes_staff.offline')}</Text>
      ) : null}
      {error ? (
        <Text className="px-4 pb-1 text-xs text-red-600">{error}</Text>
      ) : null}

      {mode === 'player' ? (
        filteredPlayers.length === 0 ? (
          <EmptyState message={t('mensajes_staff.no_players')} />
        ) : (
          <FlatList
            data={filteredPlayers}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 16, gap: 4 }}
            renderItem={({ item }) => (
              <Row
                label={formatPlayerName(item.first_name, item.last_name)}
                busy={busyId === item.id}
                disabled={!online || busyId != null}
                accent={accent}
                onPress={() => openPlayer(item)}
              />
            )}
          />
        )
      ) : mode === 'team' ? (
        filteredTeams.length === 0 ? (
          <EmptyState message={t('mensajes_staff.no_teams')} />
        ) : (
          <FlatList
            data={filteredTeams}
            keyExtractor={(team) => team.id}
            contentContainerStyle={{ padding: 16, gap: 4 }}
            renderItem={({ item }) => (
              <Row
                icon="👥"
                label={item.name}
                busy={busyId === item.id}
                disabled={!online || busyId != null}
                accent={accent}
                onPress={() => openTeam(item)}
              />
            )}
          />
        )
      ) : staffSections.length === 0 ? (
        <EmptyState message={t('mensajes_staff.no_staff')} />
      ) : (
        <SectionList
          sections={staffSections}
          keyExtractor={(item) => item.profileId}
          contentContainerStyle={{ padding: 16 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t(`mensajes_staff.role_group.${section.role}`)}
            </Text>
          )}
          renderItem={({ item }) => (
            <Row
              label={item.fullName}
              busy={busyId === item.profileId}
              disabled={!online || busyId != null}
              accent={accent}
              onPress={() => openStaff(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function Segment({
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
      className="rounded-full border px-4 py-1.5 active:opacity-80"
      style={{
        borderColor: active ? accent : '#E4E4E7',
        backgroundColor: active ? `${accent}14` : '#FFFFFF',
      }}
    >
      <Text className="text-sm font-medium" style={{ color: active ? accent : '#71717a' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  icon,
  label,
  busy,
  disabled,
  accent,
  onPress,
}: {
  icon?: string;
  label: string;
  busy: boolean;
  disabled: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center gap-2 border-b border-zinc-100 py-3 active:opacity-70"
      style={{ opacity: disabled && !busy ? 0.5 : 1 }}
    >
      {icon ? <Text className="text-base">{icon}</Text> : null}
      <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
        {label}
      </Text>
      {busy ? <ActivityIndicator size="small" color={accent} /> : null}
    </Pressable>
  );
}
