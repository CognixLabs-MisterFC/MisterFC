import { useApp } from '@/auth/context';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/** Carcasa JUGADOR / FAMILIA (barra: Inicio · Calendario · Directos · Mensajes). */
export default function FamilyLayout() {
  const { activeClub } = useApp();
  return (
    <RoleChrome area="family" role={activeClub?.role ?? null}>
      <AreaNavigator area="family" />
    </RoleChrome>
  );
}
