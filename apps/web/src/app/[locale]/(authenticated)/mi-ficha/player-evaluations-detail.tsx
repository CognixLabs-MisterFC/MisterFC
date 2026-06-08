'use client';

import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';

export type MatchEvaluation = {
  eventId: string;
  /** ISO de `events.starts_at` (orden cronológico ascendente ya aplicado). */
  startsAt: string;
  /** Rival o título del partido. */
  label: string;
  /** Nota individual 1-10 (null = sin valorar ese partido). */
  rating: number | null;
  isMvp: boolean;
  /** Comentario VISIBLE del staff (nunca el privado — ese ni se consulta). */
  comment: string | null;
  /** Valoración COLECTIVA del equipo en ese partido (contexto, 🔒 D9-3). */
  teamRating: number | null;
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/**
 * F9.5 — valoraciones del jugador en la vista jugador/familia (SOLO con el flag
 * `club_settings.evaluations_player_visibility` ON; con OFF la RLS de F8 devuelve
 * 0 filas → el padre no renderiza esta sección). Muestra, por partido: nota
 * individual + MVP + comentario VISIBLE, y la valoración COLECTIVA como contexto.
 * NUNCA muestra el comentario privado ni notas transversales (no se consultan).
 */
export function PlayerEvaluationsDetail({
  items,
}: {
  items: MatchEvaluation[];
}) {
  const t = useTranslations('mi_ficha.evaluations');

  const rated = items.filter((i) => i.rating != null) as Array<
    MatchEvaluation & { rating: number }
  >;
  const avg =
    rated.length > 0
      ? rated.reduce((s, i) => s + i.rating, 0) / rated.length
      : null;
  const mvpCount = items.filter((i) => i.isMvp).length;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('title')}
      </h3>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-misterfc-green/10 px-2 py-1 font-semibold text-misterfc-green tabular-nums">
          {avg == null ? '—' : avg.toFixed(2)} {t('avg')}
        </span>
        <span className="text-muted-foreground">
          {t('rated_count', { count: rated.length })}
        </span>
        {mvpCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground">
            <Star className="size-3.5 fill-current text-amber-500" aria-hidden />
            {t('mvp_count', { count: mvpCount })}
          </span>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {items.map((i) => (
          <li key={i.eventId} className="flex flex-col gap-1 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{i.label}</span>
                {i.isMvp && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600">
                    <Star className="size-3 fill-current" aria-hidden />
                    {t('mvp')}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {shortDate(i.startsAt)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                {t('individual')}:{' '}
                <span className="font-semibold tabular-nums">
                  {i.rating ?? '—'}
                </span>
              </span>
              {i.teamRating != null && (
                <span className="text-muted-foreground">
                  {t('collective')}:{' '}
                  <span className="font-semibold tabular-nums">
                    {i.teamRating}
                  </span>
                </span>
              )}
            </div>
            {i.comment && (
              <p className="text-sm text-muted-foreground">{i.comment}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
