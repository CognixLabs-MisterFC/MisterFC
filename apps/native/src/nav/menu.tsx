import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/auth/context';
import { NEUTRAL_COLOR, type ClubTheme } from '@/theme';
import { useTranslations } from '@/locale/provider';
import { hrefFor, type ChromeArea, type MenuDef } from './config';

/**
 * O2-12a T2 — Mapa de reuso de los labels de nav: la clave de `config.ts`
 * (`nav.<x>`, que NO se toca esta tanda) → la clave del catálogo COMPARTIDO. Solo
 * las que la web YA tiene con el MISMO texto se reapuntan a `shell.nav.*` (producto
 * único, sin duplicar); el resto cae a `nav.<x>` (namespace propio de la app, misma
 * subclave que config). Vive aquí (menu es hoja del grafo nav) y lo importan
 * `navigator.tsx` y `placeholder.tsx` sin crear ciclos. Una tanda futura que migre
 * `config.ts` lo hará desaparecer.
 */
const NAV_I18N_KEYS: Record<string, string> = {
  'nav.inicio': 'shell.nav.home',
  'nav.calendario': 'shell.nav.calendario',
  'nav.directos': 'shell.nav.directos',
  'nav.mensajes': 'shell.nav.mensajes',
  'nav.dashboard': 'shell.nav.dashboard',
  'nav.equipos': 'shell.nav.equipos',
  'nav.jugadores': 'shell.nav.jugadores',
  'nav.jugadores_consulta': 'shell.nav.jugadores',
  'nav.cuerpo_tecnico': 'shell.nav.cuerpo_tecnico',
  'nav.mi_equipo': 'shell.nav.mi_equipo',
  'nav.mis_equipos': 'shell.nav.mis_equipos',
  'nav.mi_ficha': 'shell.nav.mi_ficha',
  'nav.seguidores': 'shell.nav.seguidores',
  'nav.supresiones': 'shell.nav.supresiones',
};

/** Resuelve la clave del catálogo compartido para un `labelKey` de config. */
export function navI18nKey(labelKey: string): string {
  return NAV_I18N_KEYS[labelKey] ?? labelKey;
}

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
  const t = useTranslations(''); // claves con ruta completa (nav labels compartidos + shell.*)

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
              <Text className="text-base text-zinc-800">{t(navI18nKey(item.labelKey))}</Text>
            </Pressable>
          ))}

          {/* Selector de club: solo si pertenece a más de uno. */}
          {clubs.length > 1 && (
            <View className="mt-4 px-4">
              <Text className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
                {t('shell.switch_club')}
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
                {t('shell.signout')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
