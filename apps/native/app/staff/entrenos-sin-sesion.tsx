import { StaffPendingTrainingsScreen } from '@/screens/staff/pending-trainings-list';

/**
 * O2-16 — Ruta OCULTA (href:null): entrenos SIN SESIÓN (a menos de 24 h, sin sesión
 * real vinculada). Se alcanza desde la tarjeta del inicio del entrenador.
 */
export default function Screen() {
  return <StaffPendingTrainingsScreen variant="without_session" />;
}
