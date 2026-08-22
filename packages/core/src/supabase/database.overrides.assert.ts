/**
 * O2-1c — CANDADO de tipos de los overrides (compile-only, sin runtime).
 *
 * Verifica que los 26 puntos de `database.overrides.ts` son efectivamente
 * `string | null` en el `Database` FINAL (generado + overrides fusionados). Si
 * alguien borra un override —o un `db:types` futuro deja de aplicarlo—, este
 * fichero ROMPE el `typecheck` en CI. Lo compila el `tsc --noEmit` de core.
 *
 * El predicado `IsStringOrNull` es estricto a propósito: exige que el tipo sea
 * subtipo de `string | null` Y que incluya `null`. Así detecta los dos modos de
 * fallo: (a) que el override no se aplique y quede `string` (no incluye null), y
 * (b) que una columna `inet` quede `unknown` (no es subtipo de string | null).
 */
import type { Database } from './types';

type Fn = Database['public']['Functions'];
type Tbl = Database['public']['Tables'];

/** true solo si T ⊆ (string | null | undefined) y además incluye null. */
type IsStringOrNull<T> = [T] extends [string | null | undefined]
  ? [null] extends [T]
    ? true
    : false
  : false;

/** Falla la compilación si T no es exactamente `true`. */
type Assert<T extends true> = T;

/** true solo si T ⊆ string (rechaza null/undefined): para las aserciones de preservación. */
type IsPlainString<T> = [T] extends [string] ? true : false;

/** true solo si T ⊆ (number | null | undefined) y además incluye null (columnas numéricas nullable). */
type IsNumberOrNull<T> = [T] extends [number | null | undefined]
  ? [null] extends [T]
    ? true
    : false
  : false;

// ─────────────────────────────────────────────────────────────────────────────
// GRUPO A — 7 params de RPC que aceptan NULL (el generador emite `string`).
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertGroupA = [
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_allergies']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_medication']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_medical_conditions']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_emergency_contact']>>,
  Assert<IsStringOrNull<Fn['set_player_photo']['Args']['p_path']>>,
  Assert<IsStringOrNull<Fn['set_club_logo']['Args']['p_path']>>,
  Assert<IsStringOrNull<Fn['set_club_color']['Args']['p_color']>>,
];

// ─────────────────────────────────────────────────────────────────────────────
// GRUPO B — 18 columnas de RETURNS TABLE(...) nullable marcadas no-null.
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertGroupB = [
  Assert<IsStringOrNull<Fn['audit_get_conversation']['Returns'][number]['read_at']>>,
  Assert<IsNumberOrNull<Fn['promotion_candidates']['Returns'][number]['dorsal']>>,
  Assert<IsStringOrNull<Fn['promotion_candidates']['Returns'][number]['last_name']>>,
  Assert<IsStringOrNull<Fn['promotion_conflicts']['Returns'][number]['ends_at']>>,
  Assert<IsStringOrNull<Fn['replace_play_with_proposal']['Returns'][number]['play_name']>>,
  Assert<IsStringOrNull<Fn['get_player_medical']['Returns'][number]['allergies']>>,
  Assert<IsStringOrNull<Fn['get_player_medical']['Returns'][number]['medication']>>,
  Assert<IsStringOrNull<Fn['get_player_medical']['Returns'][number]['medical_conditions']>>,
  Assert<IsStringOrNull<Fn['get_player_medical']['Returns'][number]['emergency_contact']>>,
  Assert<IsStringOrNull<Fn['get_public_club_by_slug']['Returns'][number]['logo_path']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consents']['Returns'][number]['player_id']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consents']['Returns'][number]['player_name']>>,
  Assert<IsStringOrNull<Fn['list_player_spectators']['Returns'][number]['email']>>,
  Assert<IsStringOrNull<Fn['list_player_spectators']['Returns'][number]['full_name']>>,
  Assert<IsStringOrNull<Fn['list_public_clubs']['Returns'][number]['logo_path']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['logo_path']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['owner_name']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['owner_profile_id']>>,
];

// ─────────────────────────────────────────────────────────────────────────────
// GRUPO C — 6 columnas `inet` (Row/Insert/Update de audit_log y consents).
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertGroupC = [
  Assert<IsStringOrNull<Tbl['audit_log']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['audit_log']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['audit_log']['Update']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Update']['ip']>>,
];

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVACIÓN — el merge con `recurseIntoArrays` NO debe pisar las columnas
// hermanas no-override de los `Returns` (demuestra que fusiona, no reemplaza).
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertPreservation = [
  // platform_list_clubs conserva columnas no-null contiguas al override:
  Assert<IsPlainString<Fn['platform_list_clubs']['Returns'][number]['id']>>,
  Assert<IsPlainString<Fn['platform_list_clubs']['Returns'][number]['name']>>,
  Assert<IsPlainString<Fn['platform_list_clubs']['Returns'][number]['slug']>>,
  // get_tutor_consents conserva su columna `title` (no-null) y el enum:
  Assert<IsPlainString<Fn['get_tutor_consents']['Returns'][number]['title']>>,
];
