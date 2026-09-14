/**
 * O2-1c — OVERRIDES de precisión sobre los tipos generados (`database.ts`).
 *
 * `database.ts` es 100 % autogenerado por `pnpm db:types` (CLI de Supabase) y NO
 * se edita a mano. Pero el generador PIERDE nullability en dos sitios que la BD
 * sí permite, porque el metadato no existe a nivel de introspección de Postgres:
 *
 *   1. Parámetros de función (RPC): en SQL un parámetro no declara nullabilidad;
 *      cualquier argumento puede recibir NULL salvo que el cuerpo lo rechace. El
 *      generador emite `string` (no-null) siempre. La convención correcta es
 *      `string | null` (así lo pasa apps/web: limpiar logo/color/foto = NULL,
 *      campos médicos opcionales = NULL).
 *
 *   2. Columnas de `RETURNS TABLE(...)`: las columnas declaradas ad-hoc no llevan
 *      `NOT NULL`, así que el generador las marca no-null aunque la función pueda
 *      devolver NULL. (Ojo: cuando una RPC devuelve `SETOF <tabla>` el generador
 *      SÍ acierta la nullability desde la tabla; esos no necesitan override.)
 *
 *   3. Columnas `inet`: el CLI 2.98.2 no mapea el tipo `inet` y emite `unknown`.
 *      La representación real en el cliente JS es un string (o NULL).
 *
 * Estos overrides se aplican ENCIMA de lo generado en `types.ts` vía `MergeDeep`
 * (con `recurseIntoArrays`, para fusionar los elementos de los `Returns: {...}[]`
 * sin perder las demás columnas). Reintroducen EXACTAMENTE la precisión perdida y
 * NADA más. Al vivir en un fichero aparte, un `db:types` futuro NO puede volver a
 * romperlos: se re-aplican solos.
 *
 * ⚠️ NO borres entradas de aquí pensando que "sobran" porque el generado ya dice
 * `string`: eso es JUSTO el bug que este fichero corrige. El fichero de
 * aserciones `database.overrides.assert.ts` es el candado que lo verifica en CI.
 */

export type DatabaseOverrides = {
  public: {
    Tables: {
      // (3) `inet` → el CLI emite `unknown`; en el cliente es string | null.
      audit_log: {
        Row: { ip: string | null };
        Insert: { ip?: string | null };
        Update: { ip?: string | null };
      };
      consents: {
        Row: { ip: string | null };
        Insert: { ip?: string | null };
        Update: { ip?: string | null };
      };
    };
    Functions: {
      // (1) Args de RPC que aceptan NULL (el generador emite no-null).
      set_player_medical: {
        // Campos médicos opcionales: apps/web pasa `field()` → string | null.
        Args: {
          p_allergies: string | null;
          p_medication: string | null;
          p_medical_conditions: string | null;
          p_emergency_contact: string | null;
        };
      };
      set_player_photo: {
        // `clearPlayerPhotoPath` pasa p_path: null para quitar la foto.
        Args: { p_path: string | null };
      };
      set_club_logo: {
        // `setClubLogo(path: string | null)` — null = quitar el logo.
        Args: { p_path: string | null };
      };
      set_club_color: {
        // `setClubColor(color: string | null)` — null = quitar el color.
        Args: { p_color: string | null };
      };

      // (2) Columnas nullable de RETURNS TABLE(...) que el generador marca no-null.
      audit_get_conversation: {
        // `messages.read_at` es NULL mientras el mensaje no está leído.
        Returns: { read_at: string | null }[];
      };
      finalize_account_deletion: {
        // No es RETURNS TABLE: devuelve la RUTA del avatar en Storage para que el
        // servidor borre el objeto, y NULL cuando no había avatar o cuando la solicitud
        // ya estaba resuelta (la RPC es idempotente para el cron). El generador emite
        // `string` porque el tipo declarado es `text` a secas.
        Returns: string | null;
      };
      get_player_medical: {
        Returns: {
          allergies: string | null;
          medication: string | null;
          medical_conditions: string | null;
          emergency_contact: string | null;
        }[];
      };
      get_public_club_by_slug: {
        Returns: { logo_path: string | null }[];
      };
      get_tutor_consents: {
        Returns: {
          player_id: string | null;
          player_name: string | null;
        }[];
      };
      list_player_spectators: {
        Returns: {
          email: string | null;
          full_name: string | null;
        }[];
      };
      list_public_clubs: {
        Returns: { logo_path: string | null }[];
      };
      platform_list_clubs: {
        Returns: {
          logo_path: string | null;
          owner_name: string | null;
          owner_profile_id: string | null;
        }[];
      };
      preview_account_deletion: {
        // `players.last_name` es nullable (y F14-7 lo pone a NULL al suprimir).
        Returns: { last_name: string | null }[];
      };
      promotion_candidates: {
        // `players.dorsal` y `players.last_name` son nullable.
        Returns: {
          dorsal: number | null;
          last_name: string | null;
        }[];
      };
      promotion_conflicts: {
        // Proyecta `events.ends_at` CRUDO (nullable); el coalesce vive solo en el WHERE.
        Returns: { ends_at: string | null }[];
      };
      replace_play_with_proposal: {
        // `play_name := v_prop.name` donde v_prop es plays%rowtype (plays.name nullable).
        Returns: { play_name: string | null }[];
      };

      // ── MN-5 · FUNCIÓN QUE FALTA EN LO GENERADO, no una precisión perdida ────
      //
      // `invite_player_self` (MN-2) está aplicada en producción, pero `database.ts`
      // no la trae: el fichero generado que hay en el repo es anterior. Y NO se
      // puede arreglar con `pnpm db:types`, que es lo que habría que hacer: medido
      // hoy, regenerar con el CLI 2.98.2 —el que el proyecto tiene PINEADO— devuelve
      // un fichero que rompe el typecheck de core en 20 sitios de `subscription/`
      // (nullability distinta en `webhook.ts` y `reconcile-sweep.ts`). El generado
      // que está commiteado lo produjo un CLI más nuevo. Reconciliar el pin es un
      // trabajo aparte y no cabe dentro de esta serie.
      //
      // Esta entrada es el mínimo para poder llamar a la RPC con tipos en vez de con
      // un cast a ciegas. Firma tomada de la definición viva. CUANDO se regeneren
      // los tipos de verdad, BÓRRALA: dejará de hacer falta.
      invite_player_self: {
        Args: { p_player_id: string; p_email: string };
        Returns: { id: string; token: string; email: string }[];
      };

      // MN-6 — los dos helpers de MN-1, por el mismo motivo y con la misma fecha de
      // caducidad: `database.ts` es anterior a la migración y regenerarlo con el CLI
      // pineado rompe el typecheck de core. Firmas tomadas de la definición viva.
      user_manages_player: {
        Args: { p_player_id: string };
        Returns: boolean;
      };
      user_manages_player_sensitive: {
        Args: { p_player_id: string };
        Returns: boolean;
      };

      // MN-9 — misma historia y misma fecha de caducidad que las de arriba: la
      // migración 20261072000000 es posterior al `database.ts` commiteado. Firma
      // tomada de la definición viva (`returns text`, un escalar, no un set).
      player_self_account_status: {
        Args: { p_player_id: string };
        Returns: string;
      };

      // R-2 — el contador del endpoint público de aceptación (migración
      // 20261074000000). `register_...` es un `returns table(...)`, así que devuelve
      // un ARRAY de filas aunque siempre traiga una: el tipo lo dice para que el
      // handler no se olvide de coger la primera. `p_ip` es `inet` con default, de
      // ahí el opcional; `purge_...` no lleva argumentos y devuelve el recuento.
      register_invite_accept_attempt: {
        Args: { p_token: string; p_ip?: string };
        Returns: { decision: string; retry_after_seconds: number }[];
      };
      purge_invite_accept_attempts: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
  };
};
