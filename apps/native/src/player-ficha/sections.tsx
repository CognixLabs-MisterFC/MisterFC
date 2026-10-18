import { Pressable, Text, View } from 'react-native';
import type {
  AggregatedStats,
  AttendanceBreakdown,
  Badge,
  DerivedRatios,
  MatchStatsByType,
  PlayerMatchEvaluation,
  PlayerCareer,
} from '@misterfc/core';

/**
 * Los BLOQUES de la ficha de un jugador, compartidos por las dos pantallas que la
 * pintan: "Mi ficha" (familia, el hijo) y la ficha de consulta del cuerpo técnico
 * y de dirección.
 *
 * Existen aquí porque las dos pantallas ya tenían su propia copia de `Section`,
 * `Grid` y del bloque de valoraciones, y la ficha de staff estaba a punto de
 * convertirse en la tercera. Dos copias de un bloque de pintura no dan un fallo:
 * dan dos fichas que se parecen cada vez menos.
 *
 * Son PUROS de datos: reciben lo que `getPlayerFichaFromClient` ya devuelve y no
 * hacen lecturas. Los TÍTULOS llegan por parámetro a propósito — cada superficie
 * tiene los suyos en el catálogo (`ficha.*`, `mi_ficha.*`) y esto no inventa
 * cadenas ni obliga a unificarlas.
 *
 * Nada de esto se renderiza en los tests (en esta app las pantallas no se montan;
 * decisión documentada en `player-contact/tutor-rows.ts`): lo que se vigila es el
 * CÓDIGO FUENTE, en `screens/ficha-compartida.test.ts`.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Grid({ items }: { items: [string, string][] }) {
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

function Ratio({ label, v, pct: isPct }: { label: string; v: number | null; pct?: boolean }) {
  const text = v == null ? '—' : isPct ? `${Math.round(v * 100)}%` : v.toFixed(2);
  return (
    <Text className="text-xs text-zinc-500">
      {label}: <Text className="font-semibold text-[#0F1B2E]">{text}</Text>
    </Text>
  );
}

/** Edad a partir de la fecha de nacimiento, o null si no hay fecha o no es fecha. */
export function ageText(dob: string | null, t: T): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return `${age} ${t('ficha.years')}`;
}

export function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

/** Línea de identidad bajo el nombre: #dorsal · edad · posición · pie. */
export function identityLine(
  identity: {
    dateOfBirth: string | null;
    dorsal: number | null;
    positionMain: string | null;
    foot: string | null;
  },
  t: T,
): string {
  return [
    identity.dorsal != null ? `#${identity.dorsal}` : null,
    ageText(identity.dateOfBirth, t),
    identity.positionMain ? t(`jugadores.positions.${identity.positionMain}`) : null,
    identity.foot ? t(`jugadores.feet.${identity.foot}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Selector de temporada. No se pinta con una sola: no hay nada que elegir. */
export function SeasonChips({
  seasons,
  active,
  onPick,
  accent,
}: {
  seasons: readonly string[];
  active: string | null;
  onPick: (season: string) => void;
  accent: string;
}) {
  if (seasons.length <= 1) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {seasons.map((sea) => {
        const on = sea === active;
        return (
          <Pressable
            key={sea}
            onPress={() => onPick(sea)}
            className={`rounded-full px-3 py-1 ${on ? '' : 'border border-zinc-200'}`}
            style={on ? { backgroundColor: accent } : undefined}
          >
            <Text className={on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-500'}>
              {sea}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Sufijo de nivel para las escalonadas (mismo criterio que la web); null para el resto. */
function levelSuffix(badge: Badge): string | null {
  if (badge.kind === 'veteran' && badge.level) return ROMAN[badge.level] ?? '';
  if (badge.kind === 'mvp_match') return `×${badge.value}`;
  return null;
}

/** Chip de un logro: nombre del catálogo compartido (`badges.name.<kind>`) + nivel. */
function BadgeChip({ badge, t, accent }: { badge: Badge; t: T; accent: string }) {
  const suffix = levelSuffix(badge);
  return (
    <View
      className="flex-row items-center gap-1.5 rounded-full border px-3 py-1"
      style={{ borderColor: `${accent}4D`, backgroundColor: `${accent}1A` }}
    >
      <Text className="text-sm font-medium" style={{ color: accent }}>
        {t(`badges.name.${badge.kind}`)}
      </Text>
      {suffix ? (
        <Text className="text-sm font-semibold tabular-nums" style={{ color: accent }}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

export function FichaBadges({
  badges,
  title,
  t,
  accent,
}: {
  badges: Badge[] | null;
  title: string;
  t: T;
  accent: string;
}) {
  if (!badges || badges.length === 0) return null;
  return (
    <Section title={title}>
      <View className="flex-row flex-wrap gap-2">
        {badges.map((b) => (
          <BadgeChip key={`${b.kind}-${b.level ?? 0}`} badge={b} t={t} accent={accent} />
        ))}
      </View>
    </Section>
  );
}

/**
 * Números de la temporada + ratios, y OPCIONALMENTE el desglose por tipo de
 * partido. El desglose es opcional porque no sirve igual a los dos lados: a un
 * entrenador le dice si los goles son de liga o de amistosos, y en la ficha del
 * hijo es ruido. Sin `byType` el bloque es exactamente el de antes.
 */
export function FichaStats({
  stats,
  ratios,
  byType,
  title,
  t,
}: {
  stats: AggregatedStats;
  ratios: DerivedRatios;
  byType?: MatchStatsByType;
  title: string;
  t: T;
}) {
  return (
    <Section title={title}>
      <Grid
        items={[
          [t('ficha.matches'), String(stats.matches)],
          [t('ficha.starts'), String(stats.starts)],
          [t('ficha.minutes'), String(stats.minutesPlayed)],
          [t('ficha.goals'), String(stats.goals)],
          [t('ficha.assists'), String(stats.assists)],
          [t('ficha.shots'), String(stats.shots)],
          [t('ficha.yellow'), String(stats.yellowCards)],
          [t('ficha.red'), String(stats.redCards)],
        ]}
      />
      <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
        <Ratio label={t('ficha.goals_per_match')} v={ratios.goalsPerMatch} />
        <Ratio label={t('ficha.minutes_per_match')} v={ratios.minutesPerMatch} />
        <Ratio label={t('ficha.start_rate')} v={ratios.startRate} pct />
      </View>
      {byType ? <ByType byType={byType} t={t} /> : null}
    </Section>
  );
}

/** Oficial / Amistoso / Torneo, con la misma clasificación que el informe y la web. */
function ByType({ byType, t }: { byType: MatchStatsByType; t: T }) {
  const filas: [string, typeof byType.total][] = [
    [t('informes.ficha.official'), byType.oficial],
    [t('informes.ficha.friendly'), byType.amistoso],
    [t('informes.ficha.tournament'), byType.torneo],
  ];
  // Una fila vacía no informa de nada: si el equipo no juega torneos, sobra.
  const visibles = filas.filter(([, s]) => s.matches > 0);
  if (visibles.length === 0) return null;
  return (
    <View className="mt-3 border-t border-zinc-100 pt-2">
      {visibles.map(([label, s]) => (
        <View key={label} className="flex-row items-center justify-between py-1">
          <Text className="text-xs text-zinc-500">{label}</Text>
          <Text className="text-xs text-zinc-600 tabular-nums">
            {`${s.matches} ${t('ficha.matches_short')} · ${s.minutesPlayed}′ · ${s.goals} ${t('ficha.goals_short')}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function FichaAttendance({
  attendance,
  title,
  t,
}: {
  attendance: AttendanceBreakdown;
  title: string;
  t: T;
}) {
  return (
    <Section title={title}>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-zinc-500">{t('ficha.attendance_pct')}</Text>
        <Text className="text-lg font-bold text-[#0F1B2E]">{pct(attendance.presentPct)}</Text>
      </View>
      <Grid
        items={[
          [t('ficha.att_present'), String(attendance.perBucket.present)],
          [t('ficha.att_justified'), String(attendance.perBucket.justified)],
          [t('ficha.att_unjustified'), String(attendance.perBucket.unjustified)],
          [t('ficha.att_partial'), String(attendance.perBucket.partial)],
        ]}
      />
    </Section>
  );
}

export function FichaEvaluations({
  evaluations,
  title,
  accent,
}: {
  evaluations: readonly PlayerMatchEvaluation[];
  title: string;
  accent: string;
}) {
  if (evaluations.length === 0) return null;
  return (
    <Section title={title}>
      {evaluations.map((e) => (
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
  );
}

export function FichaCareer({
  career,
  title,
  t,
}: {
  career: PlayerCareer;
  title: string;
  t: T;
}) {
  if (career.bySeason.length === 0) return null;
  return (
    <Section title={title}>
      {career.bySeason.map((cs) => (
        <View
          key={cs.season}
          className="flex-row items-center justify-between border-b border-zinc-100 py-1.5"
        >
          <Text className="text-sm text-[#0F1B2E]">{cs.season}</Text>
          <Text className="text-xs text-zinc-500">
            {`${cs.stats.matches} ${t('ficha.matches_short')} · ${cs.stats.goals} ${t('ficha.goals_short')}${cs.rating != null ? ` · ${cs.rating.toFixed(1)}★` : ''}`}
          </Text>
        </View>
      ))}
      <View className="mt-1 flex-row items-center justify-between pt-1">
        <Text className="text-sm font-semibold text-[#0F1B2E]">{t('ficha.career_total')}</Text>
        <Text className="text-xs font-semibold text-zinc-600">
          {`${career.totals.stats.matches} ${t('ficha.matches_short')} · ${career.totals.stats.goals} ${t('ficha.goals_short')}`}
        </Text>
      </View>
    </Section>
  );
}
