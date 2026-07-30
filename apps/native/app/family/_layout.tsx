import { useApp } from '@/auth/context';
import { AreaGuard } from '@/nav/area-guard';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/** Carcasa JUGADOR / FAMILIA (barra: Inicio · Calendario · Directos · Mensajes). */
export default function FamilyLayout() {
  const { activeClub } = useApp();
  return (
    <AreaGuard area="family">
      <RoleChrome area="family" role={activeClub?.role ?? null}>
        <AreaNavigator area="family" />
      </RoleChrome>
    </AreaGuard>
  );
}
