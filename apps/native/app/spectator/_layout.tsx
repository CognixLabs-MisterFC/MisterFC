import { AreaGuard } from '@/nav/area-guard';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';
import { SpectatorPlayerProvider } from '@/auth/spectator-player';

/**
 * Carcasa SEGUIDOR (barra: Agenda · Directos · Estadísticas · Perfil). El
 * seguidor no es un rol de club → sin club activo → tema neutro y sin selector
 * de club. `role={null}`. O2-6: monta el JUGADOR SEGUIDO ACTIVO (provider) que
 * scopea agenda/directos/estadísticas al jugador elegido.
 */
export default function SpectatorLayout() {
  return (
    <AreaGuard area="spectator">
      <SpectatorPlayerProvider>
        <RoleChrome area="spectator" role={null}>
          <AreaNavigator area="spectator" />
        </RoleChrome>
      </SpectatorPlayerProvider>
    </AreaGuard>
  );
}
