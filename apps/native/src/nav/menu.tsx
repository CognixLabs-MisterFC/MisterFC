import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/auth/context';
import { NEUTRAL_COLOR, type ClubTheme } from '@/theme';
import { t } from '@/i18n';
import { hrefFor, type ChromeArea, type MenuDef } from './config';

/**
 * O2-2 — MENÚ HAMBURGUESA. Overlay propio (Modal de react-native), sin
 * `@react-navigation/drawer` ni gesture-handler (no resolubles bajo pnpm
 * estricto → riesgo de bundle). Lista el RESTO de pantallas del rol (las que no
 * están en la barra), el selector de club (si el usuario tiene más de uno) y
 * cerrar sesión. Todas las pantallas son placeholders.
 */
export function AppMenu({
  visible,
  area,
  items,
  theme,
  onClose,
}: {
  visible: boolean;
  area: ChromeArea;
  items: MenuDef[];
  theme: ClubTheme;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { clubs, activeClub, setActiveClub, signOut } = useApp();

  const go = (name: string) => {
    onClose();
    router.push(hrefFor(area, name));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Scrim: toca fuera para cerrar. */}
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />

      {/* Panel lateral. */}
      <View
        className="absolute bottom-0 left-0 top-0 w-4/5 max-w-sm bg-white"
        style={{ paddingTop: insets.top }}
      >
        {/* Cabecera del panel con el color del club. */}
        <View
          className="h-16 justify-center px-4"
          style={{ backgroundColor: theme.color }}
        >
          <Text className="text-lg font-bold text-white" numberOfLines={1}>
            {theme.clubName}
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        >
          {items.map((item) => (
            <Pressable
              key={item.name}
              onPress={() => go(item.name)}
              className="border-b border-zinc-100 px-4 py-4 active:bg-zinc-50"
            >
              <Text className="text-base text-zinc-800">{t(item.labelKey)}</Text>
            </Pressable>
          ))}

          {/* Selector de club: solo si pertenece a más de uno. */}
          {clubs.length > 1 && (
            <View className="mt-4 px-4">
              <Text className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
                {t('nav.cambiar_club')}
              </Text>
              <View className="gap-2">
                {clubs.map((c) => {
                  const active = c.club.id === activeClub?.club.id;
                  const color = c.club.primary_color ?? NEUTRAL_COLOR;
                  return (
                    <Pressable
                      key={c.club.id}
                      onPress={() => {
                        onClose();
                        void setActiveClub(c.club.id);
                      }}
                      className="flex-row items-center gap-2 rounded-lg border px-3 py-2 active:opacity-80"
                      style={{
                        borderColor: active ? color : '#E4E4E7',
                        backgroundColor: active ? `${color}14` : '#FFFFFF',
                      }}
                    >
                      <View
                        className="size-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <Text
                        className="flex-1 text-sm"
                        style={{ color: active ? color : '#3F3F46' }}
                        numberOfLines={1}
                      >
                        {c.club.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Cerrar sesión. */}
          <View className="mt-4 px-4">
            <Pressable
              onPress={() => {
                onClose();
                void signOut();
              }}
              className="items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
            >
              <Text className="text-base font-medium text-zinc-700">
                {t('nav.cerrar_sesion')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
