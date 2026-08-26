import { Text, View } from 'react-native';
import { useApp } from '@/auth/context';
import { useTranslations } from '@/locale/provider';

/**
 * Baja de miembros (4c) — banner informativo en las pantallas SIN club (none/spectator).
 * Lee las bajas del usuario del contexto (`removedMemberships`, que solo se puebla cuando
 * no tiene clubes activos). Si no hay bajas → no pinta NADA (el usuario nuevo que llega a
 * "sin acceso" ve exactamente lo de siempre).
 *
 * `variant`:
 *  - 'member'    → none (web onboarding equivalente): "ya no perteneces a {club}".
 *  - 'spectator' → seguidor: añade que su SEGUIMIENTO no se ve afectado, para que no llame
 *    al club creyendo que ha perdido también lo de su hijo.
 *
 * NUNCA muestra la razón de la baja: la RPC ni la devuelve.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de baja como DD/MM/AAAA (determinista, sin depender del idioma del dispositivo). */
function formatLeftAt(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function RemovedBanner({ variant }: { variant: 'member' | 'spectator' }) {
  const { removedMemberships } = useApp();
  const t = useTranslations('membership_removed');

  if (removedMemberships.length === 0) return null;

  const titleKey = variant === 'spectator' ? 'spectator_title' : 'title';
  const bodyKey = variant === 'spectator' ? 'spectator_body' : 'body';

  return (
    <View className="gap-2 p-4">
      {removedMemberships.map((m) => (
        <View
          key={m.club_id}
          className="gap-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <Text className="text-sm font-semibold text-amber-900">
            {t(titleKey, { club: m.club_name })}
          </Text>
          <Text className="text-xs text-amber-800">
            {t(bodyKey, { club: m.club_name, date: formatLeftAt(m.left_at) })}
          </Text>
        </View>
      ))}
    </View>
  );
}
