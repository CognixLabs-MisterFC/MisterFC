import { useApp } from '@/auth/context';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/** Carcasa DIRECCIÓN — admin_club · director (barra: Inicio · Equipos · Directos · Mensajes). */
export default function DirectionLayout() {
  const { activeClub } = useApp();
  return (
    <RoleChrome area="direction" role={activeClub?.role ?? null}>
      <AreaNavigator area="direction" />
    </RoleChrome>
  );
}
