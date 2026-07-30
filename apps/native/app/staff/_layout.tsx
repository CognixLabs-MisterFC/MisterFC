import { useApp } from '@/auth/context';
import { AreaGuard } from '@/nav/area-guard';
import { RoleChrome } from '@/nav/chrome';
import { AreaNavigator } from '@/nav/navigator';

/**
 * Carcasa CUERPO TÉCNICO (barra: Inicio · Equipo · Calendario · Directos ·
 * Mensajes). El coordinador comparte esta barra y añade extras en el menú
 * (lo resuelve `menuForArea` a partir del rol del club activo).
 */
export default function StaffLayout() {
  const { activeClub } = useApp();
  return (
    <AreaGuard area="staff">
      <RoleChrome area="staff" role={activeClub?.role ?? null}>
        <AreaNavigator area="staff" />
      </RoleChrome>
    </AreaGuard>
  );
}
