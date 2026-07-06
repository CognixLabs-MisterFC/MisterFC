import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { type Role, STAFF_ROLES } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { ExerciseForm } from '../../_components/exercise-form';
import { loadExercise } from '../../queries';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

const ALLOWED_VIEW_ROLES = STAFF_ROLES;

export default async function EditarEjercicioPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) redirect(`/${locale}`);

  const exercise = await loadExercise(ctx.activeClub.club.id, id);
  // No visible / no existe / otro club → 404 (confía en la RLS de 11.1).
  if (!exercise) notFound();

  // El autor edita SUS borrador/propuesto/rechazado (rechazado: corrige y
  // reprone, 11.7). El Admin (dueño de la metodología del club) edita además los
  // PROPUESTOS y PUBLICADOS del club (12.7a: poder etiquetar/ajustar la biblioteca
  // ya publicada). No reimplementa permisos: la RLS/trigger de 11.1 gatea al
  // guardar (un draft ajeno ni siquiera es visible → notFound antes de aquí).
  const isAdmin = role === 'admin_club';
  const editable =
    (exercise.is_owner &&
      (exercise.status === 'draft' ||
        exercise.status === 'proposed' ||
        exercise.status === 'rejected')) ||
    (isAdmin && (exercise.status === 'proposed' || exercise.status === 'published'));
  if (!editable) redirect(`/${locale}/ejercicios/${id}`);

  const tForm = await getTranslations('ejercicios.form');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link
        href={`/ejercicios/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {tForm('back_to_card')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{tForm('edit_title')}</h1>
      <ExerciseForm
        isAdmin={role === 'admin_club'}
        initial={{
          id: exercise.id,
          status: exercise.status,
          name: exercise.name,
          categories: exercise.categories,
          tactical_objectives: exercise.tactical_objectives,
          technical_objectives: exercise.technical_objectives,
          phases: exercise.phases,
          physical_focus: exercise.physical_focus,
          intensity: exercise.intensity,
          space_type: exercise.space_type,
          space_dimensions: exercise.space_dimensions,
          base_duration: exercise.base_duration,
          objective: exercise.objective,
          description: exercise.description,
          coaching_points: exercise.coaching_points,
          variants: exercise.variants,
          players: exercise.players,
          diagram: exercise.diagram,
        }}
      />
    </div>
  );
}
