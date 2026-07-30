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
    };
  };
};
