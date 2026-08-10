import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  translate,
  getProfileFromClient,
  type TranslateValues,
} from '@misterfc/core';
import { CATALOGS, DEFAULT_LOCALE, isLocale, type Locale } from './catalogs';
import { getStoredLocale, setStoredLocale } from './store';
import { useSession } from '@/auth/session';
import { supabase } from '@/lib/supabase';

/**
 * Provider REACTIVO de idioma para apps/native (O2-12a). Regla de producto:
 *   · Arranca SIEMPRE en español si el usuario no ha elegido. NUNCA se lee el
 *     idioma del dispositivo (no hay Intl/detectLocale).
 *   · Cambio EN CALIENTE: `setLocale` re-renderiza la pantalla visible al momento.
 *   · Persistencia local (secure-store, clave con userId) para arranque instantáneo;
 *     `profiles.locale` es la verdad y GANA cuando llega (fetch al conocer el user).
 *
 * Además mantiene un espejo del locale a nivel de módulo (`appLocale()`) para los
 * consumidores NO reactivos: handlers que construyen URLs de route handlers web o el
 * locale de fan-out de push (no pueden usar el hook).
 */
type LocaleContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Espejo del locale a nivel de módulo para consumidores NO reactivos (`appLocale()`).
 * Arranca en el default español y el Provider lo actualiza al resolver el idioma; en el
 * hueco previo (arranque / sesión recién iniciada) devuelve 'es', NUNCA undefined —
 * una URL construida con undefined rompería, p. ej., el enlace de reset de contraseña.
 */
let currentAppLocale: Locale = DEFAULT_LOCALE;

/**
 * Locale activo para consumidores NO reactivos (no-hook): URLs de route handlers de la
 * web y locale de fan-out. Devuelve el default 'es' hasta que el Provider resuelve el
 * idioma del usuario; nunca undefined.
 */
export function appLocale(): string {
  return currentAppLocale;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Aplica un locale: estado (re-render) + espejo de módulo (appLocale) + (opcional) caché local.
  const applyLocale = useCallback((l: Locale, uid: string | null, persist: boolean) => {
    setLocaleState(l);
    currentAppLocale = l;
    if (persist && uid) void setStoredLocale(uid, l);
  }, []);

  // Cambio explícito del usuario (selector): hot-switch + caché local siempre.
  const setLocale = useCallback(
    (l: Locale) => applyLocale(l, userId, true),
    [applyLocale, userId],
  );

  // Inicialización / reconciliación al cambiar de usuario. Todo el setState va dentro
  // del callback async (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) {
        // Sin sesión (login) → siempre el default, sin tocar caché.
        if (active) applyLocale(DEFAULT_LOCALE, null, false);
        return;
      }
      // 1) Instantáneo: la última elección cacheada (sin esperar red).
      const cached = await getStoredLocale(userId);
      if (active && isLocale(cached)) applyLocale(cached, userId, false);
      // 2) Verdad: profiles.locale (online). Si difiere, gana y re-cachea.
      try {
        const profile = await getProfileFromClient(supabase, userId);
        const loc = profile?.locale;
        if (active && isLocale(loc)) {
          applyLocale(loc, userId, true);
        }
      } catch {
        // Offline o error: nos quedamos con la caché/el default.
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, applyLocale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
  );
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale debe usarse dentro de <LocaleProvider>');
  return ctx;
}

/** Locale activo (reactivo). */
export function useLocale(): Locale {
  return useLocaleContext().locale;
}

/** Cambia el idioma en caliente + lo cachea en secure-store. NO escribe profiles.locale. */
export function useSetLocale(): (l: Locale) => void {
  return useLocaleContext().setLocale;
}

/**
 * Hook de traducción, calcado a `useTranslations('perfil')` de next-intl: devuelve
 * `t(key, values?)` sobre el catálogo COMPARTIDO del locale activo. Re-renderiza al
 * cambiar el idioma (suscribe al contexto).
 */
export function useTranslations(namespace: string): (key: string, values?: TranslateValues) => string {
  const { locale } = useLocaleContext();
  return useCallback(
    (key: string, values: TranslateValues = {}) =>
      translate(CATALOGS[locale], namespace, key, values, locale),
    [locale, namespace],
  );
}
