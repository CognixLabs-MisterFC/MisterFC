import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import {
  getInboxFromClient,
  countUnreadConversations,
  profileScopedCacheKey,
  type InboxItem,
} from '@misterfc/core';
import { useChrome, AppHeader } from './chrome';
import { AREA_TABS, allMenuFiles, type ChromeArea } from './config';
import { navI18nKey } from './menu';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useTranslations } from '@/locale/provider';

/** Verde de "sin leer" (emerald-500), el mismo del punto de novedades y del pill del inbox. */
const UNREAD_GREEN = '#10b981';

/**
 * Punto 11 QA — Nº de CONVERSACIONES con mensajes sin leer para el badge de la
 * pestaña de Mensajes. Se deriva del MISMO inbox que pinta la lista (misma cache-key
 * `inbox.<tutor>`) con el MISMO criterio de core (`countUnreadConversations`), así el
 * badge, la lista y el contador del inicio SIEMPRE dicen lo mismo y baja al leer (la
 * invalidación `markConversationRead` recarga los tres). Igual que el badge de la web
 * (F5/E-8): conversaciones 1:1 + chats de equipo con no-leídos, cada chat = 1.
 *
 * Todas las áreas con pestaña de Mensajes (familia, staff y dirección) comparten este
 * navigator, el inbox (`getInboxFromClient`, user-scoped por RLS) y el criterio, así
 * que el badge es idéntico en todas. `spectator` no tiene pestaña de Mensajes. Sin
 * sesión (`profileId=null`) no consulta y devuelve 0.
 */
function useUnreadConversations(): number {
  const { user } = useSession();
  const profileId = user?.id ?? null;
  const { data } = useCached<InboxItem[]>(
    profileId ? profileScopedCacheKey('inbox', profileId) : 'inbox.none',
    (sb) => (profileId ? getInboxFromClient(sb, profileId) : Promise.resolve([])),
  );
  return countUnreadConversations(data ?? []);
}

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
  // Badge verde de mensajes sin leer (familia, staff y dirección; mismo criterio).
  const unreadConversations = useUnreadConversations();

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
            // Círculo verde con el nº de conversaciones sin leer (WhatsApp-style).
            // Solo en la pestaña de Mensajes y cuando hay no-leídos.
            ...(tab.name === 'mensajes' && unreadConversations > 0
              ? {
                  tabBarBadge: unreadConversations,
                  tabBarBadgeStyle: { backgroundColor: UNREAD_GREEN, color: '#ffffff' },
                }
              : {}),
          }}
        />
      ))}

      {allMenuFiles(area).map((item) => (
        <Tabs.Screen key={item.name} name={item.name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
