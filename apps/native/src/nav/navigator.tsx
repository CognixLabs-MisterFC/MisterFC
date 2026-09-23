import { Text } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import {
  getInboxFromClient,
  countUnreadConversations,
  nextAreaInSwitch,
  profileScopedCacheKey,
  type InboxItem,
  type Role,
} from '@misterfc/core';
import { useChrome, AppHeader } from './chrome';
import {
  AREA_TABS,
  AREA_SWITCH_LOOK,
  SWITCH_TAB_NAME,
  allMenuFiles,
  hasSwitchTab,
  hrefFor,
  type ChromeArea,
} from './config';
import { navI18nKey } from './menu';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
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

  // Pestaña CONMUTADOR de área: UN botón que ROTA por las áreas que este usuario
  // tiene (dirección → míster → familia → dirección). Quién tiene qué y qué viene
  // después lo decide core con la MISMA regla que el guard que deja entrar: si la
  // barra ofreciera un área que el guard rechaza, el botón rebotaría al gatekeeper
  // sin error ni pista.
  //
  // La lista de hijos llega en asíncrono, así que en el primer render un tutor aún
  // no cuenta como tal y el botón puede nombrar la siguiente parada sin familia.
  // Dura lo que la consulta; esperar a que asiente retrasaría el conmutador de
  // Míster/Club a TODO el mundo, y eso sí sería un paso atrás.
  const router = useRouter();
  const { kind, activeClub, hasStaffTeams } = useApp();
  const { players } = useActivePlayer();
  const role = (activeClub?.role ?? null) as Role | null;
  const nextArea = nextAreaInSwitch(area, {
    kind,
    role,
    hasStaffTeams,
    hasLinkedPlayers: players.length > 0,
  });
  // El botón dice a dónde LLEVA, no dónde estás.
  const switchLook = nextArea ? AREA_SWITCH_LOOK[nextArea] : null;
  const switchLabel = switchLook ? t(navI18nKey(switchLook.labelKey)) : '';
  // Con 6 pestañas (las 5 del área + el conmutador) los rótulos se estrechan; bajamos
  // la fuente a 9 SOLO en esas dos barras para que "Calendario" (10 car.) no se corte.
  // Sin conmutador (5 pestañas) no se toca — y familia CON conmutador son 5, así que
  // tampoco: su barra queda igual de ancha que la de staff.
  const shrinkLabels = nextArea != null && area !== 'family';

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
        ...(shrinkLabels ? { tabBarLabelStyle: { fontSize: 9 } } : {}),
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

      {/* Tab conmutador (último, a la derecha de Mensajes). El fichero-ruta existe
          en las tres áreas que rotan; cuando NO toca mostrarlo se declara href:null
          (no sale en la barra, pero queda declarado: sin eso, expo-router lo sacaría
          como pestaña de más). Al pulsarlo, preventDefault + router.replace al área
          siguiente (sin apilar). */}
      {hasSwitchTab(area) && (
        <Tabs.Screen
          name={SWITCH_TAB_NAME}
          options={
            nextArea && switchLook
              ? {
                  title: switchLabel,
                  tabBarLabel: switchLabel,
                  tabBarIcon: ({ size }) => (
                    <Text style={{ fontSize: size ?? 20 }}>{switchLook.icon}</Text>
                  ),
                }
              : { href: null }
          }
          listeners={
            nextArea
              ? {
                  tabPress: (e) => {
                    e.preventDefault();
                    router.replace(hrefFor(nextArea, 'index'));
                  },
                }
              : undefined
          }
        />
      )}

      {allMenuFiles(area).map((item) => (
        <Tabs.Screen key={item.name} name={item.name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
