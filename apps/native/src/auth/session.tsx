import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type SessionState = {
  user: User | null;
  /** true hasta que se resuelve la sesión inicial desde secure-store. */
  loading: boolean;
};

const SessionContext = createContext<SessionState>({
  user: null,
  loading: true,
});

/**
 * Provee la sesión de Supabase a toda la app. La sesión se rehidrata sola desde
 * expo-secure-store (persistSession + storage del cliente) y se mantiene fresca
 * con `onAuthStateChange` (login, logout, refresh). Es la fuente de verdad del
 * gate de navegación (hay sesión → home; no hay → login).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    user: null,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setState({ user: data.session?.user ?? null, loading: false });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
