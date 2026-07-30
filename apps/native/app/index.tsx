import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import type { CurrentUserClub } from '@misterfc/core';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { t } from '@/i18n';
import { BRAND, NEUTRAL_COLOR, type ClubTheme } from '@/theme';

function Splash() {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: BRAND.navy }}
    >
      <ActivityIndicator color="#ffffff" />
    </View>
  );
}

/**
 * B6 — Pantalla PROVISIONAL post-login. Demuestra que auth + club activo + tema
 * funcionan de punta a punta: nombre del usuario, club activo (nombre, logo y
 * COLOR aplicado a un elemento visible), selector de club si hay más de uno, y
 * cerrar sesión. PR-2 la sustituye por el esqueleto de navegación real.
 */
export default function Index() {
  const { user, loading: sessionLoading } = useSession();
  const app = useApp();

  if (sessionLoading) return <Splash />;
  if (!user) return <Redirect href="/login" />;
  if (app.loading) return <Splash />;

  // B5 — SEGUIDOR: detección resuelta; la carcasa la monta PR-2.
  // TODO(PR-2): aquí enganchará el enrutado del seguidor (spectator shell:
  // lista de jugadores seguidos + agenda/directos). De momento, placeholder.
  if (app.kind === 'spectator') {
    return (
      <InfoScreen
        title={t('home.spectator_title')}
        body={t('home.spectator_body')}
        onSignOut={app.signOut}
      />
    );
  }

  // Cuenta sin club y sin seguimiento.
  if (app.kind === 'none' || !app.activeClub || !app.theme) {
    return (
      <InfoScreen
        title={t('home.no_access_title')}
        body={t('home.no_access_body')}
        onSignOut={app.signOut}
      />
    );
  }

  const theme = app.theme;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">
        <View className="gap-6 p-6">
          <Text className="text-2xl font-bold text-[#0F1B2E]">
            {t('home.greeting', { name: app.profileName ?? user.email ?? '' })}
          </Text>

          <ClubThemeCard theme={theme} />

          {app.clubs.length > 1 && (
            <View className="gap-2">
              <Text className="text-sm font-semibold text-zinc-500">
                {t('home.switch_club')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {app.clubs.map((c) => (
                  <ClubChip
                    key={c.club.id}
                    club={c}
                    active={c.club.id === app.activeClub?.club.id}
                    onPress={() => app.setActiveClub(c.club.id)}
                  />
                ))}
              </View>
            </View>
          )}

          <SignOutButton onPress={app.signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Tarjeta del club activo: el COLOR del club se aplica al banner superior. */
function ClubThemeCard({ theme }: { theme: ClubTheme }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-zinc-200">
      {/* Banner con el color del club (o neutro). Elemento VISIBLE del tema. */}
      <View
        className="h-20 flex-row items-center gap-3 px-4"
        style={{ backgroundColor: theme.color }}
      >
        {theme.logoUrl ? (
          <Image
            source={{ uri: theme.logoUrl }}
            className="size-12 rounded-lg bg-white/20"
            resizeMode="cover"
          />
        ) : (
          <View className="size-12 items-center justify-center rounded-lg bg-white/20">
            <Text className="text-xl font-bold text-white">
              {theme.clubName.trim().charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}
        <Text className="flex-1 text-lg font-bold text-white" numberOfLines={1}>
          {theme.clubName}
        </Text>
      </View>

      <View className="gap-1 p-4">
        <Text className="text-xs uppercase tracking-wide text-zinc-400">
          {t('home.active_club')}
        </Text>
        <View className="flex-row items-center gap-2">
          <View
            className="size-4 rounded-full border border-zinc-200"
            style={{ backgroundColor: theme.color }}
          />
          <Text className="text-sm text-zinc-600">
            {theme.isNeutralColor
              ? t('home.no_color')
              : `${t('home.color_label')}: ${theme.color}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ClubChip({
  club,
  active,
  onPress,
}: {
  club: CurrentUserClub;
  active: boolean;
  onPress: () => void;
}) {
  const color = club.club.primary_color ?? NEUTRAL_COLOR;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-full border px-3 py-2 active:opacity-80"
      style={{
        borderColor: active ? color : '#E4E4E7',
        backgroundColor: active ? `${color}14` : '#FFFFFF',
      }}
    >
      <View
        className="size-3 rounded-full"
        style={{ backgroundColor: color }}
      />
      <Text
        className="text-sm"
        style={{ color: active ? color : '#3F3F46' }}
        numberOfLines={1}
      >
        {club.club.name}
      </Text>
    </Pressable>
  );
}

function SignOutButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-2 items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
    >
      <Text className="text-base font-medium text-zinc-700">
        {t('home.sign_out')}
      </Text>
    </Pressable>
  );
}

/** Pantalla informativa simple (seguidor / sin acceso) con cerrar sesión. */
function InfoScreen({
  title,
  body,
  onSignOut,
}: {
  title: string;
  body: string;
  onSignOut: () => void;
}) {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-3 p-6">
        <Text className="text-2xl font-bold text-[#0F1B2E]">{title}</Text>
        <Text className="text-base text-zinc-500">{body}</Text>
        <View className="mt-4">
          <SignOutButton onPress={onSignOut} />
        </View>
      </View>
    </SafeAreaView>
  );
}
