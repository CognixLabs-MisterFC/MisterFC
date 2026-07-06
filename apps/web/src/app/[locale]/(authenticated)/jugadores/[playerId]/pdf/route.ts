/**
 * F9.B-6 — Route Handler que genera el PDF del expediente del jugador.
 *
 * RLS heredada (D7): usa la sesión del usuario (mismo cliente que las páginas),
 * así que el PDF solo contiene lo que esa persona vería en pantalla — NO es una
 * puerta trasera. El contenido (stats + carrera + logros) no incluye médicas,
 * comentario privado ni notas transversales, así que el recorte de /mi-ficha
 * (9.5) se respeta para todos. El flag de rating lo aplica `loadPlayerBadges`
 * (lee `club_settings`); con OFF no llegan badges de rating.
 *
 * Acceso: staff del club, o una cuenta vinculada al jugador (player_accounts).
 */

import { getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  formatPlayerName,
  STAFF_ROLES,
  type Badge,
  type Role,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadPlayerCareer } from '@/lib/player-career';
import { loadPlayerBadges } from '@/lib/player-badges';
import { PlayerPdfDocument } from '@/lib/pdf/player-pdf';
import { pdfResponse, slugForFile, type Translator } from '@/lib/pdf/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Etiqueta de una badge para el PDF (nombre + nivel/conteo). */
function badgeLabel(tb: Translator, b: Badge): string {
  const name = tb(`name.${b.kind}`);
  if (b.kind === 'veteran' && b.level) return `${name} ${ROMAN[b.level] ?? ''}`.trim();
  if (b.kind === 'mvp_match') return `${name} ×${b.value}`;
  return name;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; playerId: string }> }
): Promise<Response> {
  const { locale, playerId } = await params;

  const ctx = await loadShellContext();
  if (!ctx) return new Response('Unauthorized', { status: 401 });

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: player } = await supabase
    .from('players')
    .select('id, club_id, first_name, last_name, dorsal')
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== ctx.activeClub.club.id) {
    return new Response('Not found', { status: 404 });
  }

  // Acceso: staff, o cuenta vinculada al jugador.
  let allowed = STAFF_ROLES.includes(ctx.activeClub.role as Role);
  if (!allowed) {
    const { data: pa } = await supabase
      .from('player_accounts')
      .select('player_id')
      .eq('player_id', playerId)
      .eq('profile_id', ctx.user.id)
      .maybeSingle();
    allowed = pa != null;
  }
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const career = await loadPlayerCareer(supabase, playerId);
  const badges = await loadPlayerBadges(supabase, {
    playerId,
    clubId: player.club_id,
    careerMatches: career.totals.stats.matches,
  });

  // Equipo actual (activo o el más reciente) para la cabecera.
  type TmRow = {
    left_at: string | null;
    teams: { name: string; season: string; categories: { name: string } };
  };
  const { data: tmRows } = await supabase
    .from('team_members')
    .select('left_at, teams!inner(name, season, categories!inner(name))')
    .eq('player_id', playerId)
    .order('joined_at', { ascending: false });
  const rows = (tmRows ?? []) as unknown as TmRow[];
  const current = rows.find((r) => r.left_at === null) ?? rows[0] ?? null;
  const teamLine = current
    ? `${current.teams.name} · ${current.teams.categories.name} · ${current.teams.season}`
    : null;

  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', player.club_id)
    .maybeSingle();
  const clubName = club?.name ?? 'MisterFC';

  const latest = career.bySeason[0] ?? null;

  const t = (await getTranslations({
    locale,
    namespace: 'pdf',
  })) as unknown as Translator;
  const tb = (await getTranslations({
    locale,
    namespace: 'badges',
  })) as unknown as Translator;

  const playerName = formatPlayerName(player.first_name, player.last_name);

  const doc = PlayerPdfDocument({
    t,
    clubName,
    playerName,
    dorsal: player.dorsal,
    teamLine,
    seasonLabel: latest?.season ?? null,
    seasonStats: latest?.stats ?? null,
    seasonRatios: latest?.ratios ?? null,
    career,
    badgeLabels: badges.map((b) => badgeLabel(tb, b)),
  });

  return pdfResponse(
    doc,
    `${t('player.file')}-${slugForFile(playerName)}.pdf`
  );
}
