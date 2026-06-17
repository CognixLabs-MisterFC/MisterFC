import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { loadExercise, loadBoardExercises } from '../ejercicios/queries';
import { loadBoardLineup } from './board-lineup';
import { PizarraClient } from './_components/pizarra-client';
import { OnceBoard } from './_components/once-board';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ exercise?: string; event?: string }>;
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

  const { exercise: exerciseId, event: eventId } = await searchParams;

  // Modo ONCE REAL (F11B.2): viene de la alineación/directo de un partido. Carga
  // read-only la alineación oficial; si no es válida/visible → cae a la pizarra
  // estándar (en blanco). Tiene prioridad sobre ?exercise.
  if (eventId) {
    const lineup = await loadBoardLineup(ctx.activeClub.club.id, eventId);
    if (lineup) return <OnceBoard lineup={lineup} />;
  }

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

  // Lista para el picker: ejercicios visibles del club con diagrama (RLS aplica).
  const exercises = await loadBoardExercises(ctx.activeClub.club.id);

  return (
    <PizarraClient
      exerciseDiagram={exerciseDiagram}
      exerciseName={exerciseName}
      exercises={exercises}
    />
  );
}
