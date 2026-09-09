import { Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getPlayerFichaFromClient,
  getPlayerContactFromClient,
  playerScopedCacheKey,
  formatPlayerName,
  type PlayerFicha,
  type PlayerContactResult,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-11a-2 — FICHA de un jugador (DIRECCIÓN, CLUB-WIDE, SOLO LECTURA). Reutiliza el
 * mismo read de core que "Mi ficha" de familia (`getPlayerFichaFromClient`: identidad
 * + stats + asistencia + valoraciones + carrera); aquí solo se pinta, con el playerId
 * del parámetro (sin selector de hijo — dirección no monta ActivePlayerProvider).
 * NADA de edición (es web). Caché player-scoped.
 */
export function DireccionJugadorFichaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { playerId, name } = useLocalSearchParams<{ playerId?: string; name?: string }>();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<PlayerFicha | null>(
    playerScopedCacheKey('dir-ficha', clubId ?? 'none', playerId ?? 'none'),
    (sb) => (playerId ? getPlayerFichaFromClient(sb, playerId) : Promise.resolve(null)),
  );

  // Contacto en una lectura APARTE, con su propia clave: son RPC (las columnas
  // están cerradas y el correo vive en auth.users) y no deben poder tumbar la
  // ficha si fallan. Sin ip/user-agent: en un móvil no hay cabeceras de
  // petición que valga la pena inventar; la RPC apunta igual quién ha mirado.
  const { data: contact } = useCached<PlayerContactResult>(
    playerScopedCacheKey('dir-ficha-contacto', clubId ?? 'none', playerId ?? 'none'),
    (sb) =>
      playerId
        ? getPlayerContactFromClient(sb, playerId)
        : Promise.resolve({ ok: false, reason: 'error' } as PlayerContactResult),
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('ficha.empty')} />;

  const title =
    name ?? formatPlayerName(data.identity.firstName ?? '', data.identity.lastName);
  const s = data.stats;
  const att = data.attendance;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View>
          <ScreenTitle>{title}</ScreenTitle>
          <Text className="mt-0.5 text-xs text-zinc-400">
            {[
              data.identity.dorsal != null ? `#${data.identity.dorsal}` : null,
              data.identity.positionMain
                ? t(`jugadores.positions.${data.identity.positionMain}`)
                : null,
              data.identity.foot ? t(`jugadores.feet.${data.identity.foot}`) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <ContactSection contact={contact} t={t} accent={accent} />

        <Section title={`${t('ficha.stats')}${data.activeSeason ? ` · ${data.activeSeason}` : ''}`}>
          <Grid
            items={[
              [t('ficha.matches'), String(s.matches)],
              [t('ficha.starts'), String(s.starts)],
              [t('ficha.minutes'), String(s.minutesPlayed)],
              [t('ficha.goals'), String(s.goals)],
              [t('ficha.assists'), String(s.assists)],
              [t('ficha.shots'), String(s.shots)],
              [t('ficha.yellow'), String(s.yellowCards)],
              [t('ficha.red'), String(s.redCards)],
            ]}
          />
        </Section>

        <Section title={t('ficha.attendance')}>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-zinc-500">{t('ficha.attendance_pct')}</Text>
            <Text className="text-lg font-bold text-[#0F1B2E]">
              {att.presentPct == null ? '—' : `${Math.round(att.presentPct * 100)}%`}
            </Text>
          </View>
        </Section>

        {data.evaluations.length > 0 ? (
          <Section title={t('ficha.evaluations')}>
            {data.evaluations.map((e) => (
              <View key={e.eventId} className="border-b border-zinc-100 py-2">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {e.label}
                    {e.isMvp ? ' · MVP' : ''}
                  </Text>
                  <Text className="text-sm font-bold" style={{ color: accent }}>
                    {e.rating != null ? e.rating.toFixed(1) : '—'}
                  </Text>
                </View>
                {e.comment ? <Text className="mt-0.5 text-xs text-zinc-500">{e.comment}</Text> : null}
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Teléfono del niño y contacto de cada tutor. Es la razón de ser de todo esto:
 * si pasa algo en un entrenamiento, el entrenador tiene a quién llamar sin salir
 * de la ficha — los números y los correos son pulsables.
 *
 * Tres estados, y ninguno miente: sin acceso no se pinta el bloque, un fallo se
 * DICE, y «no hay teléfono» se distingue de las dos cosas anteriores.
 */
function ContactSection({
  contact,
  t,
  accent,
}: {
  contact: PlayerContactResult | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  accent: string;
}) {
  if (!contact) return null;
  if (!contact.ok) {
    if (contact.reason === 'forbidden') return null;
    return (
      <Section title={t('ficha.contact')}>
        <Text className="text-xs text-red-600">{t('ficha.contact_unavailable')}</Text>
      </Section>
    );
  }

  return (
    <Section title={t('ficha.contact')}>
      <Row
        label={t('ficha.contact_player_phone')}
        value={contact.playerPhone}
        href={contact.playerPhone ? `tel:${contact.playerPhone}` : null}
        accent={accent}
        empty={t('ficha.contact_no_phone')}
      />
      {contact.tutors.length === 0 ? (
        <Text className="mt-1 text-xs text-zinc-400">{t('ficha.contact_no_tutors')}</Text>
      ) : (
        contact.tutors.map((tu) => (
          <View key={tu.tutorProfileId} className="mt-3 border-t border-zinc-100 pt-2">
            <Text className="text-sm font-medium text-[#0F1B2E]">
              {tu.fullName ?? t(`jugadores.family.relation.${tu.relation}`)}
            </Text>
            <Text className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">
              {t(`jugadores.family.relation.${tu.relation}`)}
            </Text>
            <Row
              label={t('ficha.contact_email')}
              value={tu.email}
              href={tu.email ? `mailto:${tu.email}` : null}
              accent={accent}
              empty="—"
            />
            <Row
              label={t('ficha.contact_phone')}
              value={tu.phone}
              href={tu.phone ? `tel:${tu.phone}` : null}
              accent={accent}
              empty={t('ficha.contact_no_phone')}
            />
          </View>
        ))
      )}
    </Section>
  );
}

function Row({
  label,
  value,
  href,
  accent,
  empty,
}: {
  label: string;
  value: string | null;
  href: string | null;
  accent: string;
  empty: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-xs text-zinc-500">{label}</Text>
      {value && href ? (
        <Text
          className="text-sm font-medium"
          style={{ color: accent }}
          onPress={() => {
            void Linking.openURL(href);
          }}
        >
          {value}
        </Text>
      ) : (
        <Text className="text-sm text-zinc-400">{empty}</Text>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</Text>
      {children}
    </View>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <View className="flex-row flex-wrap">
      {items.map(([label, value]) => (
        <View key={label} className="w-1/4 py-1.5">
          <Text className="text-lg font-bold text-[#0F1B2E] tabular-nums">{value}</Text>
          <Text className="text-[10px] text-zinc-400" numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
