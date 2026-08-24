import { StaffPendingTrainingsScreen } from '@/screens/staff/pending-trainings-list';

/**
 * O2-16 — Ruta OCULTA (href:null): entrenos SIN PASAR LISTA (pasados, sin límite de
 * tiempo, solo pendientes). Se alcanza desde la tarjeta del inicio del entrenador.
 */
export default function Screen() {
  return <StaffPendingTrainingsScreen variant="without_attendance" />;
}
