import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Clock } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { loadSessionForEdit, loadSessionExerciseMeta } from '../../../sesiones/queries';

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * F12.4 — Vista READ-ONLY de una sesión publicada (jugador/familia). La RLS de
 * 12.1 (user_can_see_session: visibility='team' + team member) es el gate: si el
 * user no puede verla, loadSessionForEdit → null → notFound. Sin edición: solo
 * cabecera (objetivos, fecha, tiempo) + bloques + tareas con su duración/series.
 */
export default async function MiEquipoSesionPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const session = await loadSessionForEdit(ctx.activeClub.club.id, id);
  // Defensa en profundidad: aunque la RLS ya filtra, una sesión no publicada
  // (borrador) nunca debe abrirse desde la vista del jugador/familia.
  if (!session || session.visibility !== 'team' || session.is_template) notFound();

  // El jugador/familia no puede leer `exercises` (RLS staff) → el nombre del
  // ejercicio no se resuelve en loadSessionForEdit. El RPC session_exercise_meta
  // (12.4) trae nombre + objetivos de forma segura para esta sesión visible.
  const exMeta = await loadSessionExerciseMeta(id);

  const t = await getTranslations('mi_equipo.session');
  const tBlocks = await getTranslations('sesiones.block_types');
  const tTactical = await getTranslations('ejercicios.tactical');
  const tTechnical = await getTranslations('ejercicios.technical');

  const dateLabel = session.session_date
    ? new Date(`${session.session_date}T00:00:00`).toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/mi-equipo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>

      {/* Cabecera */}
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-2xl">
            {session.title ?? t('untitled')}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {dateLabel && <span className="capitalize">{dateLabel}</span>}
            {session.total_minutes != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-4" aria-hidden />
                {t('minutes', { count: session.total_minutes })}
              </span>
            )}
          </div>
        </CardHeader>
        {(session.tactical_objectives.length > 0 ||
          session.technical_objectives.length > 0 ||
          session.objective_physical) && (
          <CardContent className="flex flex-col gap-3 text-sm">
            {session.tactical_objectives.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('tactical')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {session.tactical_objectives.map((o) => (
                    <Badge key={o} variant="secondary">
                      {tTactical(o)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {session.technical_objectives.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('technical')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {session.technical_objectives.map((o) => (
                    <Badge key={o} variant="secondary">
                      {tTechnical(o)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {session.objective_physical && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('physical')}
                </span>
                <p className="whitespace-pre-line">{session.objective_physical}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Bloques */}
      {session.blocks.map((block) => (
        <Card key={block.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {block.title ?? tBlocks(block.block_type)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {block.tasks.length === 0 ? (
              <p className="text-muted-foreground">{t('no_exercises')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {block.tasks.map((task) => {
                  const meta = exMeta.get(task.exercise_id);
                  const name = meta?.name || task.exercise_name || t('exercise_fallback');
                  const objectives = [
                    ...(meta?.tactical_objectives ?? []).map((o) => tTactical(o)),
                    ...(meta?.technical_objectives ?? []).map((o) => tTechnical(o)),
                  ];
                  return (
                    <li
                      key={task.id}
                      className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="font-medium">{name}</span>
                      {objectives.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {objectives.map((o) => (
                            <Badge key={o} variant="outline" className="text-[11px]">
                              {o}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {task.duration_min != null && (
                          <span>{t('minutes', { count: task.duration_min })}</span>
                        )}
                        {task.series && <span>{task.series}</span>}
                        {task.notes && <span>{task.notes}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Jugadas a entrenar (JS-3, D6 estricta): la RLS de JS-0 ya filtra a solo
                las compartidas con la familia. Cada una abre el visor read-only. */}
            {block.plays.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5 border-t pt-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('plays_heading')}
                </span>
                <ul className="flex flex-col divide-y divide-border">
                  {block.plays.map((play) => (
                    <li key={play.id} className="py-2 first:pt-0 last:pb-0">
                      <Link
                        href={`/mi-equipo/jugadas/${play.play_id}`}
                        className="flex items-center justify-between gap-3 hover:text-foreground"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {play.play_name || t('play_untitled')}
                          </span>
                          {play.notes && (
                            <span className="text-xs text-muted-foreground">{play.notes}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('frame_count', { count: play.frame_count })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export const dynamic = 'force-dynamic';
