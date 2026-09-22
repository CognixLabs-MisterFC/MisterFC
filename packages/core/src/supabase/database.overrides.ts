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
 *   3. Columnas y parámetros `inet`: el generador no mapea el tipo y emite
 *      `unknown`. La representación real en el cliente JS es un string (o NULL).
 *      (No es cosa de la versión del CLI: con `--project-id` el TypeScript lo
 *      genera SUPABASE en el servidor, y el CLI solo baja la respuesta. Medido:
 *      la salida de 2.98.2 y la de 2.117.0 son byte a byte la misma.)
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
      // R-2. Hoy no la lee nadie desde el cliente (la tabla es de service_role y
      // se toca solo por RPC), pero la regla de arriba es de TIPO, no de uso: si
      // se deja fuera, el día que alguien la lea se encuentra un `unknown`.
      invite_accept_attempts: {
        Row: { ip: string | null };
        Insert: { ip?: string | null };
        Update: { ip?: string | null };
      };
      // Correo-B · recuperación — la cuarta tabla con columna `ip`, por el mismo
      // motivo que la de R-2: hoy no la lee nadie desde el cliente, pero la regla
      // es de TIPO, no de uso.
      password_recovery_attempts: {
        Row: { ip: string | null };
        Insert: { ip?: string | null };
        Update: { ip?: string | null };
      };
    };
    Functions: {
      // (1) Args de RPC que aceptan NULL (el generador emite no-null).
      // SU — las dos RPC de la suscripción. Estos overrides NO son nuevos: la
      // nullability estaba escrita A MANO dentro de `database.ts`, y regenerar se
      // la lleva por delante (19 errores de typecheck en `subscription/`). Aquí es
      // donde tenía que haber estado desde O2-1c.
      //
      // Comprobado contra la definición viva en producción, no contra el call-site:
      // en `reconcile_...` los cuatro últimos están declarados `DEFAULT NULL::text`
      // —de ahí que sigan siendo opcionales Y nullable—; el resto son parámetros sin
      // default, que en SQL admiten NULL igual. El proyector de RevenueCat devuelve
      // null en todos ellos cuando el evento no trae tienda, producto ni caducidad.
      apply_subscription_event: {
        Args: {
          p_store: string | null;
          p_product_id: string | null;
          p_store_transaction_id: string | null;
          p_expires_at: string | null;
          p_grace_period_expires_at: string | null;
          p_rc_customer_id: string | null;
        };
      };
      reconcile_subscription_entitlement: {
        Args: {
          p_expires_at: string | null;
          p_grace_period_expires_at: string | null;
          p_billing_issue_at: string | null;
          p_store?: string | null;
          p_product_id?: string | null;
          p_store_transaction_id?: string | null;
          p_rc_customer_id?: string | null;
        };
      };
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
      club_pending_invitation_by_email: {
        // `invitations.player_id` es NULL en las invitaciones que no van sobre un
        // jugador (las de staff). Y no es un caso raro: la función contesta «¿este
        // correo ya tiene algo pendiente aquí?» sin filtrar por rol, así que la fila
        // de un entrenador pendiente sale con player_id NULL por diseño.
        Returns: { player_id: string | null }[];
      };
      // La familia abre hilo (mig 20261076000000). Cuatro columnas del RETURNS TABLE
      // que SON nulas y el generador marca no-null:
      //   · conversation_id → null mientras no exista el hilo. Es LA columna que
      //     decide si la pantalla abre o crea; tiparla no-null seria mentir en el
      //     punto exacto donde se toma la decision.
      //   · full_name       → `profiles.full_name` es nullable.
      //   · team_id/team_name → null en las filas 'club' (admin y direccion no van
      //     por equipo). Esas dos son null en la MITAD de las filas, siempre.
      family_conversation_recipients: {
        Returns: {
          conversation_id: string | null;
          full_name: string | null;
          team_id: string | null;
          team_name: string | null;
        }[];
      };
      get_public_club_by_slug: {
        Returns: { logo_path: string | null }[];
      };
      // RV-3 — la rejilla: seis de las nueve columnas pueden venir a NULL, y cada
      // NULL significa algo distinto en la pantalla. `signed_*` y `decided_at` van
      // vacíos cuando NUNCA se decidió; `current_*` cuando el club no ha publicado
      // ese texto, que es justo lo que apaga el botón de conceder.
      get_tutor_consent_options: {
        Returns: {
          player_name: string | null;
          decided_at: string | null;
          signed_document_id: string | null;
          signed_document_title: string | null;
          current_document_id: string | null;
          current_document_title: string | null;
        }[];
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

      // ── LO QUE SE HA BORRADO AQUÍ, PARA QUE NADIE LO REPONGA ────────────────
      //
      // Hasta la regeneración vivían aquí seis entradas que NO eran precisión
      // perdida: eran funciones que existían en producción y no en `database.ts`,
      // porque el fichero llevaba sin regenerar desde julio (invite_player_self,
      // user_manages_player, user_manages_player_sensitive,
      // player_self_account_status y las dos de R-2). Cada una decía «BÓRRALA
      // cuando se regeneren los tipos de verdad». Regenerado: las seis están en lo
      // generado y se han ido de aquí.
      //
      // La lección, que es lo que importa: este fichero es para lo que el generador
      // NO PUEDE saber. Una función que falta no es eso — es un `pnpm db:types`
      // pendiente, y taparlo aquí hace que el fichero generado parezca al día.

      // R-2 · `p_ip` es `inet`: el generador emite `unknown` (regla 3 de arriba).
      // El handler le pasa la IP ya derivada, o null cuando no hay cabecera fiable.
      register_invite_accept_attempt: {
        Args: { p_ip?: string | null };
      };
      purge_invite_accept_attempts: {
        Args: Record<string, never>;
        Returns: number;
      };

      // Correo-B · recuperación — mismo caso que R-2: `p_ip` es `inet`, el
      // generador emite `unknown`. La puerta le pasa la IP ya derivada, o null
      // cuando no hay cabecera fiable (y entonces solo corre la regla del correo).
      register_password_recovery_attempt: {
        Args: { p_ip?: string | null };
      };
      purge_password_recovery_attempts: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
  };
};
