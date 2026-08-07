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
      screenOptions={{
        header: () => <AppHeader />,
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
