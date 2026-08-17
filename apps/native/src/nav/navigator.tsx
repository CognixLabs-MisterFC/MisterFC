import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useChrome, AppHeader } from './chrome';
import { AREA_TABS, allMenuFiles, type ChromeArea } from './config';
import { navI18nKey } from './menu';
import { useTranslations } from '@/locale/provider';

/**
 * O2-2 — Navegador de un área: BARRA inferior (pestañas frecuentes) + cabecera
 * temática (`AppHeader`, con el botón ☰ del menú). Las pantallas solo-menú se
 * declaran como `href:null` (existen y son navegables, pero NO salen en la
 * barra). El color activo de la barra es el del club (o neutro). Todo el modelo
 * viene de `config.ts`; este componente no lo reinterpreta.
 */
export function AreaNavigator({ area }: { area: ChromeArea }) {
  const { chromeTheme } = useChrome();
  // Namespace vacío: resolvemos claves con ruta completa del catálogo compartido.
  const t = useTranslations('');

  return (
    <Tabs
      // `history`: el atrás (flecha, botón físico y gesto de borde de Android)
      // retrocede a la pantalla ANTERIOR visitada —incluidos cambios de pestaña—, no
      // al inicio del área. Es la base del "volver un paso".
      backBehavior="history"
      screenOptions={{
        // El header recibe la ruta/navegación actuales (antes se ignoraban) para
        // decidir si pinta la flecha y a dónde vuelve. Pasamos primitivas/callbacks
        // para no acoplar AppHeader a los tipos de react-navigation.
        header: ({ route, navigation }) => (
          <AppHeader
            routeName={route.name}
            teamId={(route.params as { teamId?: string } | undefined)?.teamId ?? null}
            onGoBack={() => navigation.goBack()}
            isFocused={() => navigation.isFocused()}
          />
        ),
        tabBarActiveTintColor: chromeTheme.color,
        tabBarInactiveTintColor: '#9CA3AF',
      }}
    >
      {AREA_TABS[area].map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(navI18nKey(tab.labelKey)),
            tabBarLabel: t(navI18nKey(tab.labelKey)),
            tabBarIcon: ({ size }) => (
              <Text style={{ fontSize: size ?? 20 }}>{tab.icon}</Text>
            ),
          }}
        />
      ))}

      {allMenuFiles(area).map((item) => (
        <Tabs.Screen key={item.name} name={item.name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
