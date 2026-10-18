import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getPlayerFichaFromClient,
  getPlayerContactFromClient,
  playerScopedCacheKey,
  formatPlayerName,
  type Badge,
  type PlayerFicha,
  type PlayerContactResult,
} from '@misterfc/core';
import { tutorContactRows } from '@/player-contact/tutor-rows';
import { loadFichaBadges } from '@/player-ficha/badges';
import {
  loadFichaMedical,
  loadFichaNotes,
  type FichaMedical,
  type FichaNotes,
} from '@/player-ficha/staff-reads';
import { FichaMedicalSection, FichaNotesSection } from '@/player-ficha/staff-sections';
import {
  FichaAttendance,
  FichaBadges,
  FichaCareer,
  FichaEvaluations,
  FichaStats,
  Section,
  SeasonChips,
  identityLine,
} from '@/player-ficha/sections';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { PlayerAvatar } from '@/ui/player-avatar';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * FICHA de un jugador para el CUERPO TÉCNICO (SOLO LECTURA). La misma pantalla
 * para dirección y para entrenadores: lo que cada uno puede ver no lo decide esta
 * pantalla, lo decide la RLS, y ahí la diferencia no es el rango sino el EQUIPO
 * (la médica es del staff del equipo del crío, no de quien tiene más galones).
 *
 * Vivía en `screens/direction/` y solo se llegaba desde el área de dirección, que
 * es una puerta que a un entrenador no le abre (`isAllowedInArea`: direction→staff
 * sí, staff→direction nunca). Por eso se mueve al nivel neutral de `screens/`,
 * como `profile-screen`: la monta el fichero de ruta de cada área.
 *
 * Reutiliza el MISMO read de core que "Mi ficha" de familia
 * (`getPlayerFichaFromClient`) y los mismos bloques de pintura
 * (`player-ficha/sections`), con el playerId del parámetro — sin selector de hijo.
 * NADA de edición: eso es web.
 *
 * LO QUE AÑADE sobre "Mi ficha": el CONTACTO (teléfono del niño y de sus tutores,
 * pulsables), el desglose por tipo de partido y las dos superficies RESERVADAS —la
 * médica y las notas del cuerpo técnico—, cada una con su puerta en el servidor.
 *
 * Esas dos no las abre el rango sino el EQUIPO, y por eso dos personas con la misma
 * pantalla delante pueden ver cosas distintas sin que aquí haya un solo `if` de rol:
 * la médica pide ser staff del equipo del crío (o dirección) Y consentimiento de
 * salud vigente, y queda apuntada en `audit_log`; las notas piden ser cuerpo técnico
 * ACTUAL del jugador. Quien no pasa no ve el bloque — y no se le dice que esté
 * vacío, que es distinto.
 */
export function JugadorFichaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { playerId, name } = useLocalSearchParams<{ playerId?: string; name?: string }>();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;
  const [season, setSeason] = useState<string | null>(null);

  const { data, fromCache, loading } = useCached<PlayerFicha | null>(
    `${playerScopedCacheKey('ficha-staff', clubId ?? 'none', playerId ?? 'none')}.${season ?? 'def'}`,
    (sb) =>
      playerId ? getPlayerFichaFromClient(sb, playerId, { season }) : Promise.resolve(null),
  );

  // Contacto en una lectura APARTE, con su propia clave: son RPC (las columnas
  // están cerradas y el correo vive en auth.users) y no deben poder tumbar la
  // ficha si fallan. Sin ip/user-agent: en un móvil no hay cabeceras de
  // petición que valga la pena inventar; la RPC apunta igual quién ha mirado.
  const { data: contact } = useCached<PlayerContactResult>(
    playerScopedCacheKey('ficha-staff-contacto', clubId ?? 'none', playerId ?? 'none'),
    (sb) =>
      playerId
        ? getPlayerContactFromClient(sb, playerId)
        : Promise.resolve({ ok: false, reason: 'error' } as PlayerContactResult),
  );

  // Logros: dos lecturas encadenadas, en su propia clave y SIN temporada (son
  // siempre de la activa). Misma función que usa "Mi ficha".
  const { data: badges } = useCached<Badge[]>(
    playerScopedCacheKey('ficha-staff-badges', clubId ?? 'none', playerId ?? 'none'),
    (sb) => loadFichaBadges(sb, playerId ?? null, clubId),
  );

  // Médica y notas: lecturas RESERVADAS, cada una en su clave y separadas de la
  // ficha. Separadas porque sus permisos son otros —un entrenador puede tener la
  // ficha entera y ninguna de las dos—, y que una de ellas diga que no no puede
  // dejar la ficha sin pintar.
  //
  // La clave NO es `medical`: esa es la de la pantalla de gestión de familia, que
  // guarda otra forma (la fila pelada) bajo el mismo jugador. Dos lecturas
  // distintas compartiendo clave se leen la una a la otra.
  //
  // `loading` viaja hasta el bloque: sin él, «todavía no ha llegado» y «no se ha
  // podido leer» son el mismo null y el aviso saldría en cada carga.
  const medica = useCached<FichaMedical>(
    playerScopedCacheKey('ficha-staff-medica', clubId ?? 'none', playerId ?? 'none'),
    (sb) => loadFichaMedical(sb, playerId ?? null),
  );
  const notas = useCached<FichaNotes>(
    playerScopedCacheKey('ficha-staff-notas', clubId ?? 'none', playerId ?? 'none'),
    (sb) => loadFichaNotes(sb, playerId ?? null),
  );

  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('ficha.empty')} />;

  const title =
    name ?? formatPlayerName(data.identity.firstName ?? '', data.identity.lastName);
  const initials =
    (data.identity.firstName?.[0] ?? '') + (data.identity.lastName?.[0] ?? '');

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View className="flex-row items-center gap-3">
          <PlayerAvatar
            path={data.identity.photoPath}
            initials={initials}
            accent={accent}
            size={56}
          />
          <View className="flex-1">
            <ScreenTitle>{title}</ScreenTitle>
            <Text className="mt-0.5 text-xs text-zinc-400">
              {identityLine(data.identity, t)}
            </Text>
          </View>
        </View>

        <SeasonChips
          seasons={data.seasons}
          active={data.activeSeason}
          onPick={setSeason}
          accent={accent}
        />

        <ContactSection contact={contact} t={t} accent={accent} />

        {/* La médica va ARRIBA del todo, pegada al contacto: las dos son las que se
            miran con prisa. Lo demás de la ficha es para mirarlo con calma. */}
        <FichaMedicalSection value={medica.data} loading={medica.loading} t={t} />

        <FichaNotesSection value={notas.data} loading={notas.loading} t={t} />

        <FichaBadges badges={badges} title={t('badges.title')} t={t} accent={accent} />

        <FichaStats
          stats={data.stats}
          ratios={data.ratios}
          byType={data.statsByType}
          title={`${t('ficha.stats')}${data.activeSeason ? ` · ${data.activeSeason}` : ''}`}
          t={t}
        />

        <FichaAttendance attendance={data.attendance} title={t('ficha.attendance')} t={t} />

        <FichaEvaluations
          evaluations={data.evaluations}
          title={t('ficha.evaluations')}
          accent={accent}
        />

        <FichaCareer career={data.career} title={t('ficha.career')} t={t} />
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

  const tutores = tutorContactRows(contact.tutors, null);

  return (
    <Section title={t('ficha.contact')}>
      <Row
        label={t('ficha.contact_player_phone')}
        value={contact.playerPhone}
        href={contact.playerPhone ? `tel:${contact.playerPhone}` : null}
        accent={accent}
        empty={t('ficha.contact_no_phone')}
      />
      {/* La RPC devuelve TODAS las filas de player_accounts, y eso incluye la
          CUENTA PROPIA del menor (relation='self'), que aquí salía como un tutor
          más con el correo del padre dentro. Se pasa por el mismo filtro que la
          pantalla de Familia de la app: tutores y nadie más. Quien mira es
          cuerpo técnico, nunca un tutor, así que no hay fila que marcar como suya. */}
      {tutores.length === 0 ? (
        <Text className="mt-1 text-xs text-zinc-400">{t('ficha.contact_no_tutors')}</Text>
      ) : (
        tutores.map((tu) => (
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
