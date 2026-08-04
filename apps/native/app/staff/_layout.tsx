import { useApp } from '@/auth/context';
import { ActiveStaffTeamProvider } from '@/auth/active-staff-team';
import { AreaGuard } from '@/nav/area-guard';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/**
 * Carcasa CUERPO TÉCNICO (barra: Inicio · Equipo · Calendario · Directos ·
 * Mensajes). El coordinador comparte esta barra y añade extras en el menú
 * (lo resuelve `menuForArea` a partir del rol del club activo). O2-10b-2 —
 * `ActiveStaffTeamProvider` da el EQUIPO ACTIVO global que scopea sus 2 consultas;
 * para el resto del staff es inerte (sus pantallas usan teamId por navegación, 10a).
 */
export default function StaffLayout() {
  const { activeClub } = useApp();
  return (
    <AreaGuard area="staff">
      <ActiveStaffTeamProvider>
        <RoleChrome area="staff" role={activeClub?.role ?? null}>
          <AreaNavigator area="staff" />
        </RoleChrome>
      </ActiveStaffTeamProvider>
    </AreaGuard>
  );
}
