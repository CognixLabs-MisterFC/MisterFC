import { NovedadesScreen } from '@/screens/family/novedades';

/**
 * O2-10b-1a — Novedades del staff. REUSO PURO del feed por-usuario de familia
 * (getNotificationsPage/markRead de core, RLS select-own). Cero lógica nueva: el feed
 * es per-recipient, no depende del rol.
 */
export default function Screen() {
  return <NovedadesScreen />;
}
