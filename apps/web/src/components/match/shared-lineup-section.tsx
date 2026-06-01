/**
 * F6 Lote B — vista readonly de la alineación OFICIAL compartida (visibility=
 * 'team') para jugadores y familias. Server component: carga vía RLS (solo
 * devuelve datos si el user puede verla) y renderiza <MatchFieldEditor> en modo
 * readonly + el banquillo. Las notas tácticas NUNCA llegan aquí (viven en
 * lineup_tactical_notes, solo-staff).
 */

import { getTranslations } from 'next-intl/server';
import {
  createSupabaseServerClient,
  formatPlayerName,
  type PlayerPositionMain,
  type TeamFormat,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type PosShape = {
  player_id: string;
  location: 'field' | 'bench';
  position_code: string | null;
  x_pct: number | string | null;
  y_pct: number | string | null;
  players: {
    first_name: string;
    last_name: string | null;
    dorsal: number | null;
    position_main: PlayerPositionMain;
    photo_url: string | null;
  };
};

export async function SharedLineupSection({ eventId }: { eventId: string }) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // RLS solo devuelve la oficial si visibility='team' y el user es del equipo.
  const { data: lu } = await supabase
    .from('lineups')
    .select('id, formation_code')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();
  if (!lu) return null;

  const { data: ev } = await supabase
    .from('events')
    .select('teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  const format = (ev as unknown as { teams: { format: TeamFormat } } | null)
    ?.teams?.format;
  if (!format) return null;

  const { data: posRows } = await supabase
    .from('lineup_positions')
    .select(
      'player_id, location, position_code, x_pct, y_pct, players!inner(first_name, last_name, dorsal, position_main, photo_url)',
    )
    .eq('lineup_id', lu.id as string);
  const positions = (posRows ?? []).map((p) => p as unknown as PosShape);

  // Firmar fotos (bucket privado player-photos) para los chips del campo.
  const photoPaths = positions
    .map((p) => p.players.photo_url)
    .filter((p): p is string => p != null);
  const signed = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('player-photos')
      .createSignedUrls(photoPaths, 3600);
    for (const s of signedList ?? []) {
      if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
    }
  }
  const photoOf = (path: string | null): string | null =>
    path ? (signed.get(path) ?? null) : null;

  const t = await getTranslations('alineacion');
  const posLabel = (pm: PlayerPositionMain): string | null =>
    pm ? t(`pos_short.${pm}`) : null;

  const field: FieldEditorPlayer[] = positions
    .filter((p) => p.location === 'field')
    .map((p) => ({
      playerId: p.player_id,
      label: p.players.last_name || p.players.first_name,
      dorsal: p.players.dorsal,
      positionLabel: posLabel(p.players.position_main),
      photoUrl: photoOf(p.players.photo_url),
      positionCode: p.position_code,
      xPct: p.x_pct == null ? null : Number(p.x_pct),
      yPct: p.y_pct == null ? null : Number(p.y_pct),
    }));
  const bench = positions
    .filter((p) => p.location === 'bench')
    .map((p) => ({
      playerId: p.player_id,
      name: formatPlayerName(p.players.first_name, p.players.last_name),
      dorsal: p.players.dorsal,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('official_lineup_title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MatchFieldEditor
          format={format}
          formationCode={lu.formation_code as string}
          players={field}
          mode="readonly"
        />
        {bench.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t('bench')} · {bench.length}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {bench.map((b) => (
                <li
                  key={b.playerId}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
                >
                  {b.dorsal != null && (
                    <span className="font-semibold text-muted-foreground">
                      #{b.dorsal}
                    </span>
                  )}
                  {b.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
