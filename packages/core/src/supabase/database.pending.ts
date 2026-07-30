/**
 * O2-4 PR-1 — Tipos PENDIENTES DE CANONIZAR (temporal).
 *
 * Este fichero NO es como `database.overrides.ts`. Los overrides corrigen
 * precisión que el generador SIEMPRE pierde → son PERMANENTES. Esto, en cambio,
 * es TEMPORAL: describe a mano la tabla `expo_push_tokens` y la RPC
 * `register_expo_push_token` que la migración O2-4 añade, mientras `database.ts`
 * (canónico, autogenerado) todavía no las conoce porque aún no se ha regenerado.
 *
 * Se aplica por ENCIMA del merge de overrides en `types.ts` (ver allí), así el
 * cliente tipa `.from('expo_push_tokens')` y `.rpc('register_expo_push_token')`
 * sin correr `db:types`.
 *
 * ⚠️ TODO — BORRAR ESTE FICHERO (y su merge en types.ts) cuando:
 *   1. se aplique la migración `20261040000000_o2_4_expo_push_tokens.sql` a la BD, y
 *   2. se regenere el `database.ts` canónico con `pnpm db:types`.
 * A partir de entonces la tabla y la RPC vendrán del generado y esto sobra. El
 * shape de aquí ESPEJA lo que el generador producirá (mismos tipos/opcionalidad),
 * para que al canonizar el tipo efectivo no cambie y nada deje de compilar.
 * (La RPC recibe `p_platform`/`p_device_info` como opcionales no-null: el caller
 * OMITE lo que no sepa en vez de pasar null → no hará falta override permanente.)
 */

export type DatabasePending = {
  public: {
    Tables: {
      expo_push_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: string;
          device_info: string | null;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform?: string;
          device_info?: string | null;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          token?: string;
          platform?: string;
          device_info?: string | null;
          last_seen_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'expo_push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      register_expo_push_token: {
        Args: {
          p_token: string;
          p_platform?: string;
          p_device_info?: string;
        };
        Returns: undefined;
      };
    };
  };
};
