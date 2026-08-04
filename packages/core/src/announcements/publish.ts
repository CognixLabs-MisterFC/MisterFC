/**
 * O2-10b-1b — Publicar / editar / borrar anuncios, orquestación framework-agnóstica.
 *
 * A diferencia de convocatorias (7b-2), el fan-out de anuncios estaba INLINE en la
 * Server Action web. Aquí se extrae la lógica compartida (publicar como el usuario +
 * fan-out inyectado) para que la comparta el route handler nativo (bearer). La web
 * pasa a delegar (wrapper que inyecta el fan-out real + Sentry), comportamiento
 * idéntico.
 *
 * ORDEN = GARANTÍA DE SEGURIDAD (patrón F3/7b-2):
 *   1. El INSERT en `announcements` se hace con el cliente RLS del usuario. La RLS
 *      `announcements_insert_managers` es el gate: un no autorizado → 42501 →
 *      'forbidden', y NO se dispara el fan-out.
 *   2. El FAN-OUT (service-role: campana + push blindado O2-4) es un callback
 *      INYECTADO que solo se invoca DESPUÉS de un insert exitoso. Core no importa
 *      Sentry ni el admin client: ambos se inyectan.
 *
 * Editar/borrar son RLS directa (autor o manager) SIN fan-out — solo la publicación
 * inicial notifica (replica la web).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type Sb = SupabaseClient<Database>;

/** Sumidero de errores para el caller (web: Sentry). */
export type AnnouncementLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

/**
 * Fan-out inyectado (web: notifica a las familias del equipo con service-role vía
 * notify-bus). Core solo lo llama tras el insert; su implementación vive en la web.
 */
export type AnnouncementNotify = (announcementId: string) => Promise<void>;

const noopLog: AnnouncementLogger = () => {};

export type PublishAnnouncementInput = {
  clubId: string;
  authorProfileId: string;
  teamId: string;
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: string | null;
  locale: string;
};

export type PublishAnnouncementOutcome =
  | { ok: { announcementId: string } }
  | { error: 'forbidden' | 'team_not_in_club' | 'generic' };

/**
 * Publica un anuncio en un equipo. Verifica que el equipo pertenece al club
 * (defensa en profundidad, igual que la web), inserta COMO EL USUARIO (RLS = gate) y,
 * solo tras éxito, dispara el fan-out inyectado. Un fallo del fan-out NO revierte la
 * publicación (se registra y se sigue) — replica el try/catch de la Server Action.
 */
export async function publishAnnouncementFromClient(
  supabase: Sb,
  input: PublishAnnouncementInput,
  notify: AnnouncementNotify,
  logError: AnnouncementLogger = noopLog,
): Promise<PublishAnnouncementOutcome> {
  const { clubId, authorProfileId, teamId, title, body, pinned, expiresAt } = input;

  // El equipo debe pertenecer al club (el trigger/RLS lo garantiza; esto es la misma
  // comprobación que hacía la web).
  const { data: teamRow } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  const teamClubId = (teamRow?.categories as unknown as { club_id: string } | null)
    ?.club_id;
  if (!teamRow || teamClubId !== clubId) return { error: 'team_not_in_club' };

  const { data: created, error: insErr } = await supabase
    .from('announcements')
    .insert({
      team_id: teamId,
      club_id: clubId,
      author_profile_id: authorProfileId,
      title,
      body,
      pinned,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    logError(insErr ?? new Error('insert returned null'), 'publish_announcement', {
      team_id: teamId,
      club_id: clubId,
    });
    return { error: 'generic' };
  }

  // Fan-out DESPUÉS del insert. Un fallo aquí no rompe la publicación.
  try {
    await notify(created.id);
  } catch (notifyErr) {
    logError(notifyErr, 'notify_announcement', { announcement_id: created.id });
  }

  return { ok: { announcementId: created.id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Editar / borrar — RLS directa, SIN fan-out (solo publicar notifica).
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateAnnouncementPatch = {
  title?: string;
  body?: string;
  pinned?: boolean;
  expiresAt?: string | null;
};

export type UpdateAnnouncementOutcome =
  | { ok: { announcementId: string; teamId: string } }
  | { error: 'forbidden' | 'not_found' | 'generic' };

/**
 * Edita un anuncio (título/cuerpo/fijado/caducidad). RLS directa
 * (`announcements_update_author_or_manager`); 42501 → forbidden. NO re-notifica
 * (replica la web: solo la publicación inicial dispara el fan-out).
 */
export async function updateAnnouncementFromClient(
  supabase: Sb,
  announcementId: string,
  patch: UpdateAnnouncementPatch,
  logError: AnnouncementLogger = noopLog,
): Promise<UpdateAnnouncementOutcome> {
  const dbPatch: {
    title?: string;
    body?: string;
    pinned?: boolean;
    expires_at?: string | null;
  } = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.body !== undefined) dbPatch.body = patch.body;
  if (patch.pinned !== undefined) dbPatch.pinned = patch.pinned;
  if (patch.expiresAt !== undefined) dbPatch.expires_at = patch.expiresAt;

  const { data: existing } = await supabase
    .from('announcements')
    .select('id, team_id')
    .eq('id', announcementId)
    .maybeSingle();
  if (!existing) return { error: 'not_found' };
  const teamId = (existing as { team_id: string }).team_id;

  if (Object.keys(dbPatch).length === 0) {
    return { ok: { announcementId, teamId } };
  }

  const { error: updErr } = await supabase
    .from('announcements')
    .update(dbPatch)
    .eq('id', announcementId);

  if (updErr) {
    if (updErr.code === '42501') return { error: 'forbidden' };
    logError(updErr, 'update_announcement', { announcement_id: announcementId });
    return { error: 'generic' };
  }

  return { ok: { announcementId, teamId } };
}

export type DeleteAnnouncementOutcome =
  | { ok: { teamId: string } }
  | { error: 'forbidden' | 'not_found' | 'generic' };

/**
 * Borra un anuncio. RLS directa (`announcements_delete_author_or_manager`);
 * 42501 → forbidden; count 0 (la RLS no dejó borrar) → forbidden. Sin fan-out.
 */
export async function deleteAnnouncementFromClient(
  supabase: Sb,
  announcementId: string,
  logError: AnnouncementLogger = noopLog,
): Promise<DeleteAnnouncementOutcome> {
  const { data: existing } = await supabase
    .from('announcements')
    .select('id, team_id')
    .eq('id', announcementId)
    .maybeSingle();
  if (!existing) return { error: 'not_found' };
  const teamId = (existing as { team_id: string }).team_id;

  const { error: delErr, count } = await supabase
    .from('announcements')
    .delete({ count: 'exact' })
    .eq('id', announcementId);

  if (delErr) {
    if (delErr.code === '42501') return { error: 'forbidden' };
    logError(delErr, 'delete_announcement', { announcement_id: announcementId });
    return { error: 'generic' };
  }
  if (count === 0) return { error: 'forbidden' };

  return { ok: { teamId } };
}
