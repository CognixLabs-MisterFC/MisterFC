/**
 * O2-1c — CANDADO de tipos de los overrides (compile-only, sin runtime).
 *
 * Verifica que cada punto de `database.overrides.ts` es efectivamente
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
// GRUPO A — params de RPC que aceptan NULL (el generador emite `string`).
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertGroupA = [
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_allergies']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_medication']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_medical_conditions']>>,
  Assert<IsStringOrNull<Fn['set_player_medical']['Args']['p_emergency_contact']>>,
  Assert<IsStringOrNull<Fn['set_player_photo']['Args']['p_path']>>,
  Assert<IsStringOrNull<Fn['set_club_logo']['Args']['p_path']>>,
  Assert<IsStringOrNull<Fn['set_club_color']['Args']['p_color']>>,
  // SU — las dos RPC de la suscripcion. Estas 13 son las que estaban a mano dentro
  // de `database.ts` y que la primera regeneracion se llevo por delante: sin ellas
  // vuelven los 19 errores de `subscription/`. Aqui quedan ancladas.
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_store']>>,
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_product_id']>>,
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_store_transaction_id']>>,
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_expires_at']>>,
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_grace_period_expires_at']>>,
  Assert<IsStringOrNull<Fn['apply_subscription_event']['Args']['p_rc_customer_id']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_expires_at']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_grace_period_expires_at']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_billing_issue_at']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_store']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_product_id']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_store_transaction_id']>>,
  Assert<IsStringOrNull<Fn['reconcile_subscription_entitlement']['Args']['p_rc_customer_id']>>,
];

// ─────────────────────────────────────────────────────────────────────────────
// GRUPO B — columnas de RETURNS TABLE(...) nullable que el generador marca
// no-null, más 1 retorno escalar nullable (finalize_account_deletion, que no es
// RETURNS TABLE).
//
// Sin número escrito a mano, por la misma razón que el job de pgTAP dejó de
// llevarlo: decía 19 cuando ya iban 30, y un recuento que nadie comprueba
// envejece en silencio y encima induce a fiarse de él. La lista de abajo ES el
// recuento, y el compilador la ejecuta entera.
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
  // Una pendiente de staff no lleva jugador: player_id NULL por diseño.
  Assert<IsStringOrNull<Fn['club_pending_invitation_by_email']['Returns'][number]['player_id']>>,
  Assert<IsStringOrNull<Fn['get_public_club_by_slug']['Returns'][number]['logo_path']>>,
  // La familia abre hilo — `conversation_id` es la que decide abrir vs crear.
  Assert<IsStringOrNull<Fn['family_conversation_recipients']['Returns'][number]['conversation_id']>>,
  Assert<IsStringOrNull<Fn['family_conversation_recipients']['Returns'][number]['full_name']>>,
  Assert<IsStringOrNull<Fn['family_conversation_recipients']['Returns'][number]['team_id']>>,
  Assert<IsStringOrNull<Fn['family_conversation_recipients']['Returns'][number]['team_name']>>,
  // RV-3 — la rejilla de permisos: los seis NULL posibles.
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['player_name']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['decided_at']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['signed_document_id']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['signed_document_title']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['current_document_id']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consent_options']['Returns'][number]['current_document_title']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consents']['Returns'][number]['player_id']>>,
  Assert<IsStringOrNull<Fn['get_tutor_consents']['Returns'][number]['player_name']>>,
  Assert<IsStringOrNull<Fn['list_player_spectators']['Returns'][number]['email']>>,
  Assert<IsStringOrNull<Fn['list_player_spectators']['Returns'][number]['full_name']>>,
  Assert<IsStringOrNull<Fn['list_public_clubs']['Returns'][number]['logo_path']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['logo_path']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['owner_name']>>,
  Assert<IsStringOrNull<Fn['platform_list_clubs']['Returns'][number]['owner_profile_id']>>,
  // BC-1 — borrado de cuenta.
  Assert<IsStringOrNull<Fn['preview_account_deletion']['Returns'][number]['last_name']>>,
  Assert<IsStringOrNull<Fn['finalize_account_deletion']['Returns']>>,
];

// ─────────────────────────────────────────────────────────────────────────────
// GRUPO C — columnas y params `inet`, que el generador emite como `unknown`.
// ─────────────────────────────────────────────────────────────────────────────
export type _AssertGroupC = [
  Assert<IsStringOrNull<Tbl['audit_log']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['audit_log']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['audit_log']['Update']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['consents']['Update']['ip']>>,
  // R-2 — la tercera tabla con columna `ip`, y el param `inet` de su RPC.
  Assert<IsStringOrNull<Tbl['invite_accept_attempts']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['invite_accept_attempts']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['invite_accept_attempts']['Update']['ip']>>,
  Assert<IsStringOrNull<Fn['register_invite_accept_attempt']['Args']['p_ip']>>,
  // Correo-B · recuperación — la cuarta tabla con `ip`, y el param `inet` de su RPC.
  Assert<IsStringOrNull<Tbl['password_recovery_attempts']['Row']['ip']>>,
  Assert<IsStringOrNull<Tbl['password_recovery_attempts']['Insert']['ip']>>,
  Assert<IsStringOrNull<Tbl['password_recovery_attempts']['Update']['ip']>>,
  Assert<IsStringOrNull<Fn['register_password_recovery_attempt']['Args']['p_ip']>>,
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
  // RV-3 — y la rejilla conserva las tres que NO son nullable: si el merge las
  // pisara, `state` en `string | null` dejaria pasar un switch sin caso por defecto.
  Assert<IsPlainString<Fn['get_tutor_consent_options']['Returns'][number]['player_id']>>,
  Assert<IsPlainString<Fn['get_tutor_consent_options']['Returns'][number]['state']>>,
  // get_tutor_consents conserva su columna `title` (no-null) y el enum:
  Assert<IsPlainString<Fn['get_tutor_consents']['Returns'][number]['title']>>,
  // BC-1 — preview_account_deletion conserva sus 4 columnas no-null junto al override:
  Assert<IsPlainString<Fn['preview_account_deletion']['Returns'][number]['player_id']>>,
  Assert<IsPlainString<Fn['preview_account_deletion']['Returns'][number]['first_name']>>,
  Assert<IsPlainString<Fn['preview_account_deletion']['Returns'][number]['club_id']>>,
  Assert<IsPlainString<Fn['preview_account_deletion']['Returns'][number]['club_name']>>,
];
