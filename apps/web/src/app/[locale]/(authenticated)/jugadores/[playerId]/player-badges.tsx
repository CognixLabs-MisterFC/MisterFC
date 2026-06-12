import { getTranslations } from 'next-intl/server';
import {
  Award,
  CalendarCheck,
  Crown,
  Flame,
  Goal,
  Medal,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { Badge, BadgeKind } from '@misterfc/core';

/**
 * F9.6 / 9.B-5 — Sección "Logros". Presentacional: recibe las badges ya
 * calculadas (server, 9.B-4 + ensamblaje en `loadPlayerBadges`) y las pinta como
 * chips. Las escalonadas muestran nivel (Veterano I/II/III; MVP del partido ×N).
 * Cada chip lleva una leyenda breve (`title`) que explica cómo se gana.
 */

const ICONS: Record<BadgeKind, LucideIcon> = {
  top_scorer_team: Target,
  top_assister_team: Sparkles,
  top_scorer: Goal,
  iron_man: Flame,
  clean_play: ShieldCheck,
  penalty_killer: Goal,
  starter_streak: Flame,
  perfect_attendance: CalendarCheck,
  mvp_match: Crown,
  mvp_season: Trophy,
  high_rating: Star,
  veteran: Medal,
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Sufijo de nivel para las escalonadas; null para el resto. */
function levelSuffix(badge: Badge): string | null {
  if (badge.kind === 'veteran' && badge.level) return ROMAN[badge.level] ?? '';
  if (badge.kind === 'mvp_match') return `×${badge.value}`;
  return null;
}

export async function PlayerBadges({ badges }: { badges: Badge[] }) {
  const t = await getTranslations('badges');

  if (badges.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {badges.map((b) => {
        const Icon = ICONS[b.kind] ?? Award;
        const suffix = levelSuffix(b);
        return (
          <li
            key={`${b.kind}-${b.level ?? 0}`}
            title={t(`legend.${b.kind}`)}
            className="inline-flex items-center gap-1.5 rounded-full border border-misterfc-green/30 bg-misterfc-green/10 px-3 py-1 text-sm text-misterfc-green"
          >
            <Icon className="size-4" aria-hidden />
            <span className="font-medium">{t(`name.${b.kind}`)}</span>
            {suffix && (
              <span className="font-semibold tabular-nums">{suffix}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
