import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { BackHandler, Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import type { Role } from '@misterfc/core';
import { useApp } from '@/auth/context';
import { NEUTRAL_COLOR, type ClubTheme } from '@/theme';
import { useTranslations } from '@/locale/provider';
import {
  hrefFor,
  isParamSwapRoute,
  isRootTab,
  menuForArea,
  type ChromeArea,
  type MenuDef,
} from './config';
import { AppMenu } from './menu';

/** Tema neutro de la carcasa cuando no hay club activo (p.ej. seguidor). */
const NEUTRAL_CHROME: ClubTheme = {
  clubName: 'MisterFC',
  logoUrl: null,
  color: NEUTRAL_COLOR,
  isNeutralColor: true,
};

type ChromeValue = {
  area: ChromeArea;
  /** Tema del club activo aplicado a la carcasa (o neutro si no hay). */
  chromeTheme: ClubTheme;
  menuItems: MenuDef[];
  isMenuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
};

const ChromeContext = createContext<ChromeValue | null>(null);

/**
 * O2-2 — Carcasa por rol. Envuelve el navegador de pestañas de un área y aporta:
 * el TEMA del club activo (color/nombre/logo, o neutro), el estado del menú
 * hamburguesa y el overlay del menú (con selector de club y cerrar sesión). La
 * cabecera (`AppHeader`) y las pantallas leen todo esto por contexto.
 */
export function RoleChrome({
  area,
  role,
  children,
}: {
  area: ChromeArea;
  role: Role | null;
  children: ReactNode;
}) {
  const app = useApp();
  const [isMenuOpen, setMenuOpen] = useState(false);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const chromeTheme = app.theme ?? NEUTRAL_CHROME;
  const menuItems = useMemo(() => menuForArea(area, role), [area, role]);

  const value = useMemo<ChromeValue>(
    () => ({ area, chromeTheme, menuItems, isMenuOpen, openMenu, closeMenu }),
    [area, chromeTheme, menuItems, isMenuOpen, openMenu, closeMenu],
  );

  return (
    <ChromeContext.Provider value={value}>
      {children}
      <AppMenu
        visible={isMenuOpen}
        area={area}
        items={menuItems}
        theme={chromeTheme}
        onClose={closeMenu}
      />
    </ChromeContext.Provider>
  );
}

export function useChrome(): ChromeValue {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error('useChrome debe usarse dentro de <RoleChrome>');
  return ctx;
}

/**
 * Cabecera de la carcasa: fondo con el COLOR del club (o neutro), botón ☰ que
 * abre el menú, logo y nombre del club activo. La monta el `_layout` de cada área
 * como `header` de las pestañas, así aparece en todas sus pantallas.
 *
 * Botón de VOLVER: se pinta como primer elemento (antes del ☰, que NUNCA desaparece)
 * en toda pantalla que no sea raíz de pestaña, y en el detalle de las rutas swap
 * (?teamId). Al pulsarlo vuelve a la pantalla anterior (`onGoBack` = goBack del Tabs
 * con backBehavior:'history'); en el detalle swap vuelve a la LISTA limpiando teamId.
 * El atrás físico de Android y el gesto de borde disparan el MISMO evento
 * (`hardwareBackPress`): lo igualamos a la flecha para el caso swap; el resto lo deja
 * en el back por defecto (historial). Solo actúa la pantalla ENFOCADA (puede haber
 * varias cabeceras montadas). NO se toca el `View` exterior (paddingTop: insets.top).
 */
export function AppHeader({
  routeName,
  teamId,
  onGoBack,
  isFocused,
}: {
  routeName: string;
  teamId: string | null;
  onGoBack: () => void;
  isFocused: () => boolean;
}) {
  const insets = useSafeAreaInsets();
  const { area, chromeTheme, openMenu } = useChrome();
  const t = useTranslations('shell');
  const router = useRouter();

  const swapDetail = isParamSwapRoute(area, routeName) && !!teamId;
  const showBack = swapDetail || !isRootTab(area, routeName);

  // Volver a la lista de una ruta swap = navegar a la ruta base (sin params): limpia
  // teamId y muestra la lista/picker, sin añadir entrada de historial (misma ruta).
  const backToList = useCallback(() => {
    router.navigate(hrefFor(area, routeName) as Href);
  }, [router, area, routeName]);

  const onBack = useCallback(() => {
    if (swapDetail) backToList();
    else onGoBack();
  }, [swapDetail, backToList, onGoBack]);

  // Física + gesto de borde de Android = mismo evento; consistentes con la flecha.
  useEffect(() => {
    const onHardwareBack = () => {
      if (!isFocused()) return false; // solo la pantalla enfocada decide
      if (swapDetail) {
        backToList();
        return true; // manejado: detalle → lista
      }
      return false; // resto: back por defecto (historial)
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [swapDetail, isFocused, backToList]);

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: chromeTheme.color }}>
      <View className="h-14 flex-row items-center gap-3 px-4">
        {showBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            hitSlop={10}
            className="active:opacity-60"
          >
            <Text className="text-3xl leading-none text-white">‹</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel={t('menu')}
          hitSlop={10}
          className="active:opacity-60"
        >
          <Text className="text-2xl leading-none text-white">☰</Text>
        </Pressable>

        {chromeTheme.logoUrl ? (
          <Image
            source={{ uri: chromeTheme.logoUrl }}
            className="size-8 rounded-md bg-white/20"
            resizeMode="cover"
          />
        ) : null}

        <Text className="flex-1 text-lg font-bold text-white" numberOfLines={1}>
          {chromeTheme.clubName}
        </Text>
      </View>
    </View>
  );
}
