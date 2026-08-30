'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  buildTeamNameIndex,
  createSupabaseServerClient,
  hasLinkedFamily,
  playerImportPayloadSchema,
  resolveTeamName,
  type PlayerImportRow,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';
import { loadShellContext } from '@/lib/auth-shell';

export type ImportPlayersInput = {
  rows: PlayerImportRow[];
  team_id: string | null;
};

export type ImportRowDetail = {
  row_index: number;
  status: 'created' | 'linked' | 'skipped' | 'failed';
  reason?: string;
  player_id?: string;
};

export type ImportResult = {
  created: number;
  /** Reimportados que ya existían SIN familia → enlazados (no duplicados). */
  linked: number;
  skipped_duplicates: number;
  failed: number;
  details: ImportRowDetail[];
  error?: 'forbidden' | 'invalid_payload' | 'no_active_club' | 'generic';
};

/**
 * Importa un batch de jugadores al club activo del user. Loop fila a fila
 * para que un error en la N-ésima no aborte las anteriores (spec §8).
 *
 * Defense in depth:
 *  - Server re-valida con Zod (el cliente ya validó pero no es autoridad).
 *  - Dedup contra `players` del club antes del INSERT.
 *  - RLS de `players` y `team_members` confirma a nivel de BD.
 */
export async function importPlayers(
  input: ImportPlayersInput
): Promise<ImportResult> {
  const parsed = playerImportPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      created: 0,
      linked: 0,
      skipped_duplicates: 0,
      failed: 0,
      details: [],
      error: 'invalid_payload',
    };
  }

  const ctx = await loadShellContext();
  if (!ctx) {
    return {
      created: 0,
      linked: 0,
      skipped_duplicates: 0,
      failed: 0,
      details: [],
      error: 'forbidden',
    };
  }
  const role = ctx.activeClub.role;
  if (
    role !== 'admin_club' &&
    role !== 'coordinador' &&
    role !== 'entrenador_principal' &&
    role !== 'entrenador_ayudante'
  ) {
    return {
      created: 0,
      linked: 0,
      skipped_duplicates: 0,
      failed: 0,
      details: [],
      error: 'forbidden',
    };
  }

  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Importar plantilla es DE SERIE para todo el cuerpo técnico desde O2 (se
  // eliminó el sistema de capabilities). La autoridad final es la RLS de players
  // (players_insert_staff), que admite a admin/director/coord/principal/ayudante.

  const { rows, team_id } = parsed.data;

  // Rework A (A5) — resolución de equipo por fila contra los equipos del club en
  // la TEMPORADA ACTIVA (la pertenencia es por temporada). El import NO crea
  // equipos; el nombre debe casar con uno existente. Autoridad del servidor: se
  // re-resuelve aquí aunque el cliente ya lo haya validado en el preview.
  const season = await getActiveSeasonLabel(supabase, clubId);
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name')
    .eq('club_id', clubId)
    .eq('season', season);
  const teamIndex = buildTeamNameIndex(
    (teamRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))
  );

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;
  const details: ImportRowDetail[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // Dedup server-side: cubre la race condition entre dos imports concurrentes.
    // last_name nullable per F2.9 hotfix 2026-05-30: si la fila NO trae apellido,
    // matcheamos contra players con last_name IS NULL del mismo nombre+DOB; si
    // SÍ trae, ilike sobre last_name.
    let dupQuery = supabase
      .from('players')
      // player_accounts (familia) + team_members (equipo activo) para decidir, al
      // casar identidad, bloquear (con familia) vs enlazar (sin familia) sin mover
      // de equipo. El servidor es la AUTORIDAD: re-lee player_accounts aquí.
      .select('id, player_accounts(profile_id), team_members(left_at)')
      .eq('club_id', clubId)
      .ilike('first_name', row.first_name)
      .eq('date_of_birth', row.date_of_birth);
    if (row.last_name === null) {
      dupQuery = dupQuery.is('last_name', null);
    } else {
      dupQuery = dupQuery.ilike('last_name', row.last_name);
    }
    const { data: dup } = await dupQuery.maybeSingle();
    if (dup?.id) {
      const accounts =
        (dup.player_accounts as unknown as Array<{ profile_id: string }> | null) ?? [];
      // CON familia → BLOQUEA como siempre (esto NO se toca).
      if (hasLinkedFamily(accounts)) {
        skipped++;
        details.push({ row_index: i, status: 'skipped', reason: 'duplicate_in_db' });
        continue;
      }
      // SIN familia → ENLAZA: no crea duplicado; entra en el paso de invitar.
      // Equipo: se añade al del fichero SOLO si el jugador NO tiene ninguno activo
      // (Jose: un jugador ya en un equipo NO se mueve, aunque el fichero diga otro).
      const tms =
        (dup.team_members as unknown as Array<{ left_at: string | null }> | null) ?? [];
      const hasActiveTeam = tms.some((tm) => tm.left_at == null);
      if (!hasActiveTeam) {
        const resolution = resolveTeamName(row.team, teamIndex);
        let linkTeamId: string;
        if (resolution.kind === 'resolved') {
          linkTeamId = resolution.teamId;
        } else if (resolution.kind === 'none') {
          if (!team_id) {
            failed++;
            details.push({ row_index: i, status: 'failed', reason: 'team_required' });
            continue;
          }
          linkTeamId = team_id;
        } else {
          failed++;
          details.push({ row_index: i, status: 'failed', reason: 'team_not_found' });
          continue;
        }
        const { error: tmErr } = await supabase.from('team_members').insert({
          player_id: dup.id,
          team_id: linkTeamId,
        });
        // Si el enlace (única escritura del enlazado) falla, la fila va a error;
        // el lote NO aborta y las demás siguen (como #541).
        if (tmErr) {
          failed++;
          details.push({ row_index: i, status: 'failed', reason: 'link_failed' });
          Sentry.captureException(tmErr, {
            tags: { feature: 'import', step: 'link_team_members_insert' },
            extra: { row_index: i, player_id: dup.id, team_id: linkTeamId },
          });
          continue;
        }
      }
      linked++;
      details.push({ row_index: i, status: 'linked', player_id: dup.id as string });
      continue;
    }

    // Equipo por fila (rework 2026-07): se resuelve ANTES de crear al jugador,
    // porque ahora TODO jugador importado debe acabar con equipo. Reglas espejo
    // de applyTeamResolution (validate.ts); el servidor es la autoridad:
    //   · resuelto        → ese team_id.
    //   · vacío + lote     → team_id del selector de lote (fallback).
    //   · vacío + sin lote → fallo `team_required` (no se crea el jugador).
    //   · no resuelto      → fallo `team_not_found` (no se crea; no crea equipos).
    const resolution = resolveTeamName(row.team, teamIndex);
    let rowTeamId: string;
    if (resolution.kind === 'resolved') {
      rowTeamId = resolution.teamId;
    } else if (resolution.kind === 'none') {
      if (!team_id) {
        failed++;
        details.push({ row_index: i, status: 'failed', reason: 'team_required' });
        continue;
      }
      rowTeamId = team_id;
    } else {
      failed++;
      details.push({ row_index: i, status: 'failed', reason: 'team_not_found' });
      continue;
    }

    const { data: inserted, error: insErr } = await supabase
      .from('players')
      .insert({
        club_id: clubId,
        first_name: row.first_name,
        last_name: row.last_name,
        date_of_birth: row.date_of_birth,
        dorsal: row.dorsal,
        position_main: row.position_main,
        positions_secondary: row.positions_secondary,
        foot: row.foot,
        height_cm: row.height_cm,
        weight_kg: row.weight_kg,
        origin: row.origin,
        // 🔒 O2 — email de contacto/invitación; solo se guarda (sin enviar).
        invite_email: row.invite_email,
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      failed++;
      const reason =
        insErr?.code === '42501'
          ? 'rls'
          : insErr?.code === '23505'
            ? 'duplicate_constraint'
            : 'generic';
      details.push({ row_index: i, status: 'failed', reason });
      if (reason === 'generic') {
        Sentry.captureException(insErr ?? new Error('insert returned null'), {
          tags: { feature: 'import', step: 'insert_player' },
          extra: { row_index: i, club_id: clubId },
        });
      }
      continue;
    }

    created++;
    details.push({ row_index: i, status: 'created', player_id: inserted.id });

    // rowTeamId siempre está definido aquí (los casos sin equipo ya fallaron).
    const { error: tmErr } = await supabase.from('team_members').insert({
      player_id: inserted.id,
      team_id: rowTeamId,
    });
    // Si team_members falla, el player queda creado sin equipo (no marcamos
    // failed para no falsear el conteo). Lo reflejamos en details con un campo
    // reason auxiliar.
    if (tmErr) {
      details[details.length - 1] = {
        ...details[details.length - 1]!,
        reason: 'team_assign_failed',
      };
      Sentry.captureException(tmErr, {
        tags: { feature: 'import', step: 'team_members_insert' },
        extra: { row_index: i, player_id: inserted.id, team_id: rowTeamId },
      });
    }
  }

  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  revalidatePath('/[locale]/(authenticated)/plantilla/importar', 'page');

  return { created, linked, skipped_duplicates: skipped, failed, details };
}
