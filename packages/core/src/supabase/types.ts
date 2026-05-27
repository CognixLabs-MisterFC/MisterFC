/**
 * Database type placeholder.
 *
 * En Fase 1 se reemplaza por el tipo generado con:
 *   pnpm dlx supabase gen types typescript --linked > packages/core/src/supabase/database.ts
 *
 * y se reexporta como Database desde aquí.
 */

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
