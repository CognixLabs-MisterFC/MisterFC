import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  startConversationFromClient,
  createTeamConversationFromClient,
  listMessageablePlayersFromClient,
  listMessageableTeamsFromClient,
  formatPlayerName,
  type MessageablePlayer,
  type MessageableTeam,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

type Mode = 'player' | 'team';

/**
 * O2-10b-1a — "Nueva conversación" del STAFF (lo que la familia NO tiene). Elige un
 * JUGADOR (chat 1:1) o un EQUIPO (chat de grupo) y abre/crea el hilo con los
 * helpers de core (`startConversationFromClient` / `createTeamConversationFromClient`)
 * — INSERT como el usuario, la RLS es el gate (42501 → forbidden). Tras abrir el hilo
 * navega a su pantalla; el envío ya reutiliza el endpoint F3. Write-guard: crear exige
 * red (sin cola); offline → deshabilitado con aviso.
 */
export function MensajeNuevoScreen({ basePath = '/staff' }: { basePath?: string }) {
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
      const [pRes, tRes] = await Promise.all([
        listMessageablePlayersFromClient(supabase, clubId),
        listMessageableTeamsFromClient(supabase, { clubId, isAdminDir, membershipId }),
      ]);
      if (!active) return;
      if ('players' in pRes) setPlayers(pRes.players);
      if ('teams' in tRes) setTeams(tRes.teams);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [clubId, membershipId, role]);

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
      router.replace({
        pathname: `${basePath}/mensaje`,
        params: {
          conversationId: res.ok.conversationId,
          title: formatPlayerName(p.first_name, p.last_name),
        },
      });
    },
    [online, clubId, userId, busyId, router, basePath],
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
      router.replace({
        pathname: `${basePath}/mensaje-equipo`,
        params: { teamConversationId: res.ok.conversationId, title: team.name },
      });
    },
    [online, clubId, busyId, router, basePath],
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

  return (
    <View className="flex-1 bg-white">
      <View className="px-4 pt-4">
        <ScreenTitle>{t('mensajes_staff.new_title')}</ScreenTitle>
      </View>

      {/* Selector de modo: Jugador (1:1) / Equipo (grupo). */}
      <View className="flex-row gap-2 px-4 pb-2 pt-1">
        <Segment label={t('mensajes_staff.tab_player')} active={mode === 'player'} accent={accent} onPress={() => setMode('player')} />
        <Segment label={t('mensajes_staff.tab_team')} active={mode === 'team'} accent={accent} onPress={() => setMode('team')} />
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
      ) : filteredTeams.length === 0 ? (
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
