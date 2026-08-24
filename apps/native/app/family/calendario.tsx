import { CalendarShell } from '@/screens/family/calendario-shell';

/**
 * 18-F1/F3a — Calendario de FAMILIA con DOS pestañas. Usa el shell reutilizable
 * (`CalendarShell`) con los defaults de familia → se ve EXACTAMENTE igual que hoy:
 * "Próximos eventos" (agenda) por defecto y "Temporada" (MES/DÍA). Sin filtro de equipos
 * (familia no lo pasa) y sin club-wide. Staff (F3b) y dirección (F3c) montan el mismo shell
 * con sus props.
 */
export default function Screen() {
  return <CalendarShell />;
}
