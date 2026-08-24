import { DireccionCalendarioScreen } from '@/screens/direction/calendario';

/**
 * 18-F3c — Sub-destino "Festivos" del calendario de dirección: la pantalla de festivos
 * INTACTA (marcar/desmarcar festivo + aprobar/rechazar entreno en festivo). Antes se
 * montaba desde `calendario.tsx`, que ahora es la lanzadera. Alcanzada desde la tarjeta
 * del lanzador (y desde la tarjeta "approvals" del inicio).
 */
export default function Screen() {
  return <DireccionCalendarioScreen />;
}
