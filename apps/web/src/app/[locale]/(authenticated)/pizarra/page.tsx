import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { loadExercise } from '../ejercicios/queries';
import { PizarraClient } from './_components/pizarra-client';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ exercise?: string }>;
};

/**
 * F11B.1 — Pizarra táctica EFÍMERA (standalone). Solo staff. Modo en blanco o,
 * si llega `?exercise=<id>`, cargando el diagrama de ese ejercicio (validado por
 * la query existente; la RLS decide si el usuario puede verlo). Nada se guarda.
 */
const STAFF_ROLES: ReadonlyArray<Role> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

export default async function PizarraPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!STAFF_ROLES.includes(role)) redirect(`/${locale}`);

  const { exercise: exerciseId } = await searchParams;

  // Modo ejercicio: carga su diagrama (respeta RLS; null si no existe/no visible
  // o no tiene diagrama) → la pizarra cae con gracia a modo en blanco.
  let exerciseDiagram = null;
  let exerciseName: string | null = null;
  if (exerciseId) {
    const exercise = await loadExercise(ctx.activeClub.club.id, exerciseId);
    if (exercise?.diagram) {
      exerciseDiagram = exercise.diagram;
      exerciseName = exercise.name;
    }
  }

  return <PizarraClient exerciseDiagram={exerciseDiagram} exerciseName={exerciseName} />;
}
