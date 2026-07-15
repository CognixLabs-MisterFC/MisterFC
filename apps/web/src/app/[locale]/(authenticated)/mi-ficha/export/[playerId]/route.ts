/**
 * F14-8 — DERECHO DE ACCESO. Route Handler EXCLUSIVA DEL TUTOR que genera, al
 * vuelo, el PDF del expediente de su hijo. Descarga inmediata (sin solicitud ni
 * aprobación), auditada con UNA entrada 'data.export'.
 *
 * Modelo de identidad (regla 1): TUTOR = player_accounts (parent/guardian), vía
 * `user_is_tutor_of_player` — NO el rol de club ni staff. Alineado con F14-6/7.
 * A diferencia de /jugadores/[id]/pdf (staff ∪ player_accounts) y de
 * /informes/[period]/pdf (staff ∪ role='jugador'): aquí SOLO el tutor.
 *
 * Regla maestra: se reúnen los datos con la SESIÓN DEL TUTOR (RLS heredada) y se
 * reutilizan las MISMAS queries de mi-ficha / mi-informe. Lo que la RLS devuelva
 * vacío (private_notes, player_notes, evaluaciones con flag OFF, informes no
 * publicados) simplemente no aparece. NO se consultan: evaluation_private_notes,
 * player_notes, mensajes, notificaciones, ni el detalle de asistencia por sesión
 * (solo el agregado que ya ve).
 *
 * F14-8b — SÍ se exportan los CONSENTIMIENTOS: los de este jugador + los de CUENTA
 * del tutor, con el MISMO estado (latest-wins) y la MISMA fuente que la pantalla de
 * consentimientos de su perfil: la RPC `get_tutor_consents` (SECURITY DEFINER,
 * auth.uid() interno). La versión de cada documento firmado se resuelve por su
 * legal_document_id (lectura acotada por RLS al club del tutor). No toca la RPC.
 */

import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  formatPlayerName,
  attendanceBreakdown,
  PLAYER_POSITIONS,
  type Badge,
  type AttendanceRow,
  type PlayerPosition,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadPlayerCareer } from '@/lib/player-career';
import { loadPlayerBadges } from '@/lib/player-badges';
import {
  loadIndividualReport,
  loadPlayerObjectives,
  loadTeamObjectives,
  resolvePlayerTeamForSeason,
} from '../../../jugadores/[playerId]/informes/queries';
import {
  AccessExportDocument,
  type AccessExportConsent,
  type AccessExportEvaluation,
  type AccessExportReport,
  type AccessExportSeason,
} from '@/lib/pdf/access-export-pdf';
import { clubLogoDataUrl } from '@/lib/pdf/club-logo-data';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PHOTO_TTL = 300;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Etiqueta de una badge (nombre + nivel/conteo), igual que /jugadores/[id]/pdf. */
function badgeLabel(tb: Translator, b: Badge): string {
  const name = tb(`name.${b.kind}`);
  if (b.kind === 'veteran' && b.level) return `${name} ${ROMAN[b.level] ?? ''}`.trim();
  if (b.kind === 'mvp_match') return `${name} ×${b.value}`;
  return name;
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; playerId: string }> },
): Promise<Response> {
  const { locale, playerId } = await params;

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const supabase = createSupabaseServerClient(await createCookieAdapter());

  // Jugador (RLS: el tutor ve a su hijo). 404 si no existe / otro club / SUPRIMIDO.
  const { data: player } = await supabase
    .from('players')
    .select(
      'id, club_id, first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, photo_url, erased_at',
    )
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== ctx.activeClub.club.id || player.erased_at) {
    return new Response('Not found', { status: 404 });
  }

  // Guard estricto de identidad (regla 1): SOLO el tutor. Ni staff, ni dirección,
  // ni el propio jugador (relation='self'). Fuga cero → 404, no 403.
  const { data: isTutor } = await supabase.rpc('user_is_tutor_of_player', {
    p_player_id: playerId,
  });
  if (!isTutor) return new Response('Not found', { status: 404 });

  // ── Auditoría (regla 8): UNA entrada data.export, ANTES de servir el PDF. La
  //    escritura en audit_log va por RPC SECURITY DEFINER (tabla cerrada al cliente).
  const hdrs = await headers();
  const fwd = hdrs.get('x-forwarded-for');
  const auditIp = fwd ? (fwd.split(',')[0]?.trim() ?? null) : null;
  const auditUa = hdrs.get('user-agent');
  const { error: auditErr } = await supabase.rpc('record_data_export', {
    p_player_id: playerId,
    p_ip: auditIp ?? undefined,
    p_user_agent: auditUa ?? undefined,
  });
  if (auditErr) return new Response('Forbidden', { status: 403 });

  // ── Identidad + foto (data URL para @react-pdf Image; se omite si falla). ────
  let photoDataUrl: string | null = null;
  if (player.photo_url) {
    const { data: signed } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(player.photo_url, PHOTO_TTL);
    if (signed?.signedUrl) {
      try {
        const res = await fetch(signed.signedUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const mime = res.headers.get('content-type') ?? 'image/jpeg';
          photoDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch {
        photoDataUrl = null;
      }
    }
  }

  // ── Médica (regla 7): get_player_medical DIRECTO (gate de LECTURA de la RPC),
  //    NO el gate de escritura de mi-ficha. No audita al tutor (regla 1 de F14-6).
  const { data: medicalRows } = await supabase.rpc('get_player_medical', {
    p_player_id: playerId,
    p_ip: undefined,
    p_user_agent: undefined,
  });
  const medical = medicalRows?.[0] ?? null;

  // ── Histórico: carrera + badges (helpers ya usados por el PDF del jugador). ──
  const career = await loadPlayerCareer(supabase, playerId);
  const badges = await loadPlayerBadges(supabase, {
    playerId,
    clubId: player.club_id,
    careerMatches: career.totals.stats.matches,
  });
  const latest = career.bySeason[0] ?? null;

  // ── Temporadas de la trayectoria + temporada activa (idéntico a mi-ficha). ──
  const { data: history } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(name, season)')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  type HistRow = { left_at: string | null; teams: { name: string; season: string } | null };
  const histRows = (history ?? []) as unknown as HistRow[];
  const seasonSet = new Set<string>();
  let activeSeason: string | null = null;
  let teamLine: string | null = null;
  for (const h of histRows) {
    const season = h.teams?.season;
    if (season) {
      seasonSet.add(season);
      if (h.left_at === null && !activeSeason) {
        activeSeason = season;
        teamLine = h.teams?.name ? `${h.teams.name} · ${season}` : season;
      }
    }
  }
  const seasons = Array.from(seasonSet).sort((a, b) => b.localeCompare(a));
  if (!activeSeason) activeSeason = seasons[0] ?? null;

  // ── Asistencia a entrenos: SOLO el AGREGADO (regla 4) — mismo cálculo que ve
  //    en mi-ficha/badges (attendanceBreakdown). NO se lista el detalle por sesión. ──
  let attendancePct: number | null = null;
  let attendanceSessions = 0;
  if (activeSeason) {
    const { data: attRows } = await supabase
      .from('training_attendance')
      .select('code, events!inner(type, teams!inner(season))')
      .eq('player_id', playerId)
      .eq('events.type', 'training')
      .eq('events.teams.season', activeSeason);
    const br = attendanceBreakdown((attRows ?? []) as unknown as AttendanceRow[]);
    attendancePct = br.total > 0 ? br.presentPct : null;
    attendanceSessions = br.total;
  }

  // ── Evaluaciones (regla 4): solo si el club las comparte (su propia puerta: la
  //    RLS deja evaluations en 0 con el flag OFF). Misma query que mi-ficha. ──
  const evaluations: AccessExportEvaluation[] = [];
  if (activeSeason) {
    const { data: matchRows } = await supabase
      .from('match_player_stats')
      .select('event_id, events!inner(starts_at, opponent_name, title), teams!inner(season)')
      .eq('player_id', playerId)
      .eq('teams.season', activeSeason);
    type MatchRow = {
      event_id: string;
      events: { starts_at: string; opponent_name: string | null; title: string };
    };
    const matches = (matchRows ?? []) as unknown as MatchRow[];
    if (matches.length > 0) {
      const eventIds = matches.map((m) => m.event_id);
      const [{ data: evalRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('evaluations')
          .select('event_id, rating, comment, is_mvp')
          .eq('player_id', playerId)
          .in('event_id', eventIds),
        supabase.from('team_evaluations').select('event_id, rating').in('event_id', eventIds),
      ]);
      type EvalRow = { event_id: string; rating: number | null; comment: string | null; is_mvp: boolean };
      const ind = new Map<string, EvalRow>();
      for (const r of (evalRows ?? []) as EvalRow[]) ind.set(r.event_id, r);
      const team = new Map<string, number | null>();
      for (const r of (teamRows ?? []) as Array<{ event_id: string; rating: number | null }>)
        team.set(r.event_id, r.rating);
      for (const m of matches) {
        const e = ind.get(m.event_id);
        if (!e) continue; // flag OFF → ind vacío → sin evaluaciones (correcto)
        evaluations.push({
          eventId: m.event_id,
          startsAt: m.events.starts_at,
          label: m.events.opponent_name ?? m.events.title,
          rating: e.rating,
          isMvp: e.is_mvp,
          comment: e.comment,
          teamRating: team.get(m.event_id) ?? null,
        });
      }
      evaluations.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
  }

  // ── Informes formales PUBLICADOS (regla 4): la RLS de development_reports ya
  //    recorta a visibility='team' del propio jugador. Se recorren TODAS sus
  //    temporadas. Objetivos: su puerta 'development_report_shared_for_*'. ──
  const { data: seasonRows } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('club_id', player.club_id);
  const seasonIdByLabel = new Map<string, string>();
  for (const r of (seasonRows ?? []) as Array<{ id: string; label: string }>)
    seasonIdByLabel.set(r.label, r.id);

  const reportSeasons: AccessExportSeason[] = [];
  for (const seasonLabel of seasons) {
    const seasonId = seasonIdByLabel.get(seasonLabel);
    if (!seasonId) continue;
    const { data: pubRows } = await supabase
      .from('development_reports')
      .select('period')
      .eq('player_id', playerId)
      .eq('season_id', seasonId);
    const periods = (pubRows ?? []).map((r) => r.period as string);
    if (periods.length === 0) continue;
    const team = await resolvePlayerTeamForSeason(supabase, playerId, seasonLabel);
    const reports: AccessExportReport[] = [];
    for (const period of periods) {
      const report = await loadIndividualReport(supabase, playerId, seasonId, period);
      if (!report) continue;
      const [playerObjectives, teamObjectives] = await Promise.all([
        loadPlayerObjectives(supabase, playerId, seasonId),
        team ? loadTeamObjectives(supabase, team.teamId, seasonId) : Promise.resolve([]),
      ]);
      let teamReport: { scores: Record<string, number>; comment: string | null } | null = null;
      if (report.team_report_id) {
        const { data: tr } = await supabase
          .from('team_development_reports')
          .select('scores, comment')
          .eq('id', report.team_report_id)
          .maybeSingle();
        if (tr) {
          teamReport = {
            scores: (tr.scores as Record<string, number>) ?? {},
            comment: (tr.comment as string | null) ?? null,
          };
        }
      }
      reports.push({
        period,
        scores: report.scores ?? {},
        commentOverall: report.comment_overall ?? null,
        teamReport,
        playerObjectives,
        teamObjectives,
      });
    }
    if (reports.length > 0) reportSeasons.push({ seasonLabel, reports });
  }

  // ── Traductores + presentación. ──────────────────────────────────────────
  const t = (await getTranslations({ locale, namespace: 'access_export' })) as unknown as Translator;
  const tInf = (await getTranslations({ locale, namespace: 'informes' })) as unknown as Translator;
  const tb = (await getTranslations({ locale, namespace: 'badges' })) as unknown as Translator;
  const tPos = await getTranslations({ locale, namespace: 'jugadores.positions' });
  const tFoot = await getTranslations({ locale, namespace: 'jugadores.feet' });

  const playerName = formatPlayerName(player.first_name, player.last_name);
  const age = ageFromDob(player.date_of_birth);
  const validPos = (PLAYER_POSITIONS as readonly string[]).includes(player.position_main ?? '');
  const validFoot = player.foot != null && ['right', 'left', 'both'].includes(player.foot);
  const metaParts = [
    player.dorsal != null ? `#${player.dorsal}` : null,
    age != null ? t('age', { age }) : null,
    validPos ? tPos(player.position_main as PlayerPosition) : null,
    validFoot ? tFoot(player.foot as string) : null,
  ].filter(Boolean) as string[];

  // ── F14-8b — Consentimientos (estado actual latest-wins), MISMA fuente que la
  //    pantalla del perfil del tutor: get_tutor_consents(club). Devuelve las filas
  //    de CUENTA (player_id NULL: T&C/privacidad) + las de CADA hijo del tutor; se
  //    filtra a las de ESTE jugador + las de cuenta. La versión firmada se resuelve
  //    por legal_document_id (RLS acota legal_documents al club del tutor). ────────
  const { data: consentRows } = await supabase.rpc('get_tutor_consents', {
    p_club_id: player.club_id,
  });
  const rows = consentRows ?? [];

  // Versión de cada documento firmado, por su id (la RPC no la devuelve).
  const docIds = Array.from(new Set(rows.map((r) => r.legal_document_id)));
  const versionById = new Map<string, number>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from('legal_documents')
      .select('id, version')
      .in('id', docIds);
    for (const d of (docs ?? []) as Array<{ id: string; version: number }>)
      versionById.set(d.id, d.version);
  }

  const consentDateFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
  // Orden estable de presentación por tipo (cuenta y jugador).
  const ACCOUNT_ORDER: Record<string, number> = { terms_conditions: 0, privacy_policy: 1 };
  const PLAYER_ORDER: Record<string, number> = {
    image_internal: 0,
    image_social: 1,
    medical_data_processing: 2,
  };
  const toConsent = (r: (typeof rows)[number]): AccessExportConsent => ({
    title: r.title,
    granted: r.granted,
    dateLabel: consentDateFmt.format(new Date(r.accepted_at)),
    version: versionById.get(r.legal_document_id) ?? null,
  });
  const consentsAccount = rows
    .filter((r) => r.player_id === null)
    .sort((a, b) => (ACCOUNT_ORDER[a.consent_type] ?? 9) - (ACCOUNT_ORDER[b.consent_type] ?? 9))
    .map(toConsent);
  const consentsPlayer = rows
    .filter((r) => r.player_id === playerId)
    .sort((a, b) => (PLAYER_ORDER[a.consent_type] ?? 9) - (PLAYER_ORDER[b.consent_type] ?? 9))
    .map(toConsent);

  // F14B-9b — logo del club en la cabecera del PDF (base64; null si no hay/falla).
  const logoDataUrl = await clubLogoDataUrl(supabase, ctx.activeClub.club.logo_path);

  const doc = AccessExportDocument({
    t,
    tInf,
    clubName: ctx.activeClub.club.name ?? 'MisterFC',
    logoDataUrl,
    generatedAtLabel: t('generated', {
      date: new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Madrid',
      }).format(new Date()),
    }),
    playerName,
    initials: (player.first_name[0] ?? '') + (player.last_name?.[0] ?? ''),
    photoDataUrl,
    metaLine: metaParts.length > 0 ? metaParts.join('  ·  ') : null,
    teamLine,
    medical: medical
      ? {
          allergies: (medical.allergies as string | null) ?? null,
          medication: (medical.medication as string | null) ?? null,
          medical_conditions: (medical.medical_conditions as string | null) ?? null,
          emergency_contact: (medical.emergency_contact as string | null) ?? null,
        }
      : null,
    seasonLabel: latest?.season ?? null,
    seasonStats: latest?.stats ?? null,
    seasonRatios: latest?.ratios ?? null,
    career,
    badgeLabels: badges.map((b) => badgeLabel(tb, b)),
    attendancePct,
    attendanceSessions,
    reportSeasons,
    evaluations,
    consentsPlayer,
    consentsAccount,
  });

  return pdfResponse(doc, `${t('file')}-${slugForFile(playerName)}.pdf`);
}
