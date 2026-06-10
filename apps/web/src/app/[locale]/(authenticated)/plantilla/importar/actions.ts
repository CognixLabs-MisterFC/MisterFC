'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  buildTeamNameIndex,
  createSupabaseServerClient,
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
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
  player_id?: string;
};

export type ImportResult = {
  created: number;
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
      skipped_duplicates: 0,
      failed: 0,
      details: [],
      error: 'forbidden',
    };
  }

  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (role === 'entrenador_ayudante') {
    const { data: cap } = await supabase
      .from('capabilities')
      .select('granted')
      .eq('membership_id', ctx.activeClub.membershipId)
      .eq('capability_name', 'can_manage_squad')
      .maybeSingle();
    if (!cap?.granted) {
      return {
        created: 0,
        skipped_duplicates: 0,
        failed: 0,
        details: [],
        error: 'forbidden',
      };
    }
  }

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
      .select('id')
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
      skipped++;
      details.push({ row_index: i, status: 'skipped', reason: 'duplicate_in_db' });
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

    // Equipo por fila (A5): si la fila trae nombre de equipo, se usa el resuelto;
    // si no trae (o viene vacío), fallback al equipo del selector de lote.
    const resolution = resolveTeamName(row.team, teamIndex);
    let rowTeamId: string | null;
    if (resolution.kind === 'resolved') {
      rowTeamId = resolution.teamId;
    } else if (resolution.kind === 'none') {
      rowTeamId = team_id; // fallback de lote
    } else {
      // not_found: el cliente ya bloquea estas filas en el preview; defensivo.
      rowTeamId = null;
      details[details.length - 1] = {
        ...details[details.length - 1]!,
        reason: 'team_not_found',
      };
    }

    if (rowTeamId) {
      const { error: tmErr } = await supabase.from('team_members').insert({
        player_id: inserted.id,
        team_id: rowTeamId,
      });
      // Si team_members falla, el player queda creado sin equipo (no
      // marcamos failed para no falsear el conteo). Lo reflejamos en details
      // con un campo reason auxiliar.
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
  }

  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  revalidatePath('/[locale]/(authenticated)/plantilla/importar', 'page');

  return { created, skipped_duplicates: skipped, failed, details };
}
