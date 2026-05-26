/**
 * Tipos compartidos de MisterFC.
 * El tipo Database real se genera con `supabase gen types` en Fase 1.
 */

export type Locale = 'es' | 'en' | 'va';

export const SUPPORTED_LOCALES: readonly Locale[] = ['es', 'en', 'va'] as const;
export const DEFAULT_LOCALE: Locale = 'es';
