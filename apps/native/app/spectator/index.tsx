import { View } from 'react-native';
import { SpectatorAgendaScreen } from '@/screens/spectator/agenda';
import { RemovedBanner } from '@/ui/removed-banner';

export default function Screen() {
  return (
    <View className="flex-1">
      {/* Baja de miembros (4c): seguidor que fue dado de baja del club. La variante
          'spectator' aclara que su SEGUIMIENTO no se ve afectado. Si no hay bajas,
          RemovedBanner no pinta nada y la agenda queda idéntica. */}
      <RemovedBanner variant="spectator" />
      <SpectatorAgendaScreen />
    </View>
  );
}
