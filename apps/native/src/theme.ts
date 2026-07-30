/**
 * Colores de marca MisterFC (espejo de apps/web globals.css) y color neutro por
 * defecto cuando un club no tiene `primary_color`. O2-1 PR-1 NO pinta toda la
 * app: estos valores alimentan el tema expuesto por el contexto (B4/B6).
 */
export const BRAND = {
  navy: '#0F1B2E',
  green: '#10B981',
} as const;

/** Color neutro cuando el club no fijó `primary_color`. */
export const NEUTRAL_COLOR = BRAND.navy;

export type ClubTheme = {
  clubName: string;
  logoUrl: string | null;
  /** Color efectivo a pintar (primary_color del club o el neutro). */
  color: string;
  /** true si se está usando el neutro por defecto (el club no tiene color). */
  isNeutralColor: boolean;
};
