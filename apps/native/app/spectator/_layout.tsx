import { AreaGuard } from '@/nav/area-guard';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/**
 * Carcasa SEGUIDOR (barra: Agenda · Directos · Estadísticas · Perfil). El
 * seguidor no es un rol de club → sin club activo → tema neutro y sin selector
 * de club. `role={null}`.
 */
export default function SpectatorLayout() {
  return (
    <AreaGuard area="spectator">
      <RoleChrome area="spectator" role={null}>
        <AreaNavigator area="spectator" />
      </RoleChrome>
    </AreaGuard>
  );
}
