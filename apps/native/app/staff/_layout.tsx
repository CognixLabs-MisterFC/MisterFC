import { useApp } from '@/auth/context';
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
    <RoleChrome area="staff" role={activeClub?.role ?? null}>
      <AreaNavigator area="staff" />
    </RoleChrome>
  );
}
