import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Clock, Maximize, Activity, CheckCircle2, XCircle } from 'lucide-react';
import type { Role, MethodologyStatus } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DiagramView } from '@/components/match/diagram-view';
import { ExerciseActions } from '../_components/exercise-actions';
import { loadExercise } from '../queries';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

const ALLOWED_VIEW_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

const STATUS_VARIANT: Record<MethodologyStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  published: 'default',
  proposed: 'secondary',
  draft: 'outline',
  rejected: 'destructive',
};

export default async function EjercicioDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) redirect(`/${locale}`);

  const exercise = await loadExercise(ctx.activeClub.club.id, id);
  // RLS no lo deja ver / no existe / otro club → 404.
  if (!exercise) notFound();

  const t = await getTranslations('ejercicios');
  const tStatus = await getTranslations('ejercicios.status');
  const tDetail = await getTranslations('ejercicios.detail');
  const tTactical = await getTranslations('ejercicios.tactical');
  const tTechnical = await getTranslations('ejercicios.technical');
  const tCategory = await getTranslations('category_kinds');

  const spaceLabel = exercise.space_type
    ? [t(`space_types.${exercise.space_type}`), exercise.space_dimensions]
        .filter(Boolean)
        .join(' · ')
    : exercise.space_dimensions;

  // Bloques de texto largos (solo se pintan si tienen contenido).
  const textBlocks: Array<{ key: string; label: string; value: string | null }> = [
    { key: 'objective', label: tDetail('objective'), value: exercise.objective },
    { key: 'description', label: tDetail('rules'), value: exercise.description },
    { key: 'coaching_points', label: tDetail('coaching_points'), value: exercise.coaching_points },
    { key: 'variants', label: tDetail('variants'), value: exercise.variants },
    { key: 'players', label: tDetail('players'), value: exercise.players },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/ejercicios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {tDetail('back')}
        </Link>
        <ExerciseActions
          id={exercise.id}
          status={exercise.status}
          isOwner={exercise.is_owner}
          isAdmin={role === 'admin_club'}
        />
      </div>

      {/* Cabecera: nombre + estado */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{exercise.name}</h1>
          {exercise.categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {exercise.categories.map((c) => (
                <Badge key={c} variant="secondary" className="text-[10px]">
                  {tCategory(c)}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {exercise.is_owner && (
            <span className="text-[10px] uppercase tracking-wider text-emerald-400">
              {t('mine')}
            </span>
          )}
          <Badge variant={STATUS_VARIANT[exercise.status]} className="uppercase tracking-wider">
            {tStatus(exercise.status)}
          </Badge>
        </div>
      </div>

      {/* Ficha técnica: chips de parámetros */}
      <Card>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 py-4 text-sm">
          {exercise.base_duration != null && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              {t('minutes', { count: exercise.base_duration })}
            </span>
          )}
          {exercise.intensity && (
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-4 text-muted-foreground" aria-hidden />
              {tDetail('intensity')}: {t(`intensity_values.${exercise.intensity}`)}
            </span>
          )}
          {spaceLabel && (
            <span className="inline-flex items-center gap-1.5">
              <Maximize className="size-4 text-muted-foreground" aria-hidden />
              {spaceLabel}
            </span>
          )}
          {exercise.physical_focus && (
            <span className="text-muted-foreground">
              {tDetail('physical_focus')}: <span className="text-foreground">{exercise.physical_focus}</span>
            </span>
          )}
        </CardContent>
      </Card>

      {/* Objetivos táctico / técnico */}
      {(exercise.tactical_objectives.length > 0 || exercise.technical_objectives.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {exercise.tactical_objectives.length > 0 && (
            <ObjectiveCard
              title={tDetail('tactical')}
              items={exercise.tactical_objectives.map((o) => tTactical(o))}
            />
          )}
          {exercise.technical_objectives.length > 0 && (
            <ObjectiveCard
              title={tDetail('technical')}
              items={exercise.technical_objectives.map((o) => tTechnical(o))}
            />
          )}
        </div>
      )}

      {/* Representación gráfica (omitida con gracia si no hay diagrama) */}
      {exercise.diagram && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDetail('diagram')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DiagramView diagram={exercise.diagram} />
          </CardContent>
        </Card>
      )}

      {/* Bloques de texto de la tarea */}
      {textBlocks.map((b) =>
        b.value && b.value.trim().length > 0 ? (
          <Card key={b.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{b.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-foreground/90">{b.value}</p>
            </CardContent>
          </Card>
        ) : null
      )}

      {/* Metodología (read-only, sin acciones) */}
      {(exercise.status === 'published' || exercise.status === 'rejected') && (
        <Card>
          <CardContent className="py-4 text-sm">
            {exercise.status === 'published' ? (
              <p className="inline-flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                {exercise.approved_by_name
                  ? tDetail('approved_by_at', {
                      name: exercise.approved_by_name,
                      date: exercise.approved_at
                        ? new Date(exercise.approved_at).toLocaleDateString(locale)
                        : '—',
                    })
                  : tDetail('published_note')}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-2 font-medium text-destructive">
                  <XCircle className="size-4" aria-hidden />
                  {tDetail('rejected_reason')}
                </span>
                <p className="whitespace-pre-line text-foreground/90">
                  {exercise.rejection_reason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ObjectiveCard({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <Badge key={it} variant="outline" className="text-xs font-normal">
              {it}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
