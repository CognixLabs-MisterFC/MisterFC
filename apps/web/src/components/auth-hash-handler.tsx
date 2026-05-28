'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@misterfc/core';

/**
 * Captura tokens del fragment hash que Supabase Auth añade tras `verifyOtp`
 * cuando el flujo es implícito (no PKCE). Casos típicos:
 *
 *   /es/signin?next=/es/invite/{token}#access_token=...&refresh_token=...&type=invite
 *   /es/invite/{token}#access_token=...&refresh_token=...
 *
 * El middleware no puede ver el hash (los browsers no lo envían al servidor),
 * así que la lógica vive aquí en cliente:
 *
 *   1. Parsea access_token + refresh_token del hash.
 *   2. Llama supabase.auth.setSession({ access_token, refresh_token }) para
 *      escribir cookies en este dominio (lo gestiona el browser client).
 *   3. Sustituye la URL por la limpia (sin hash) — usando router.replace
 *      hacia `?next=` si existe, o el pathname actual.
 *
 * Complementario al middleware (PKCE `?code=`) y a /auth/callback
 * (`?token_hash=&type=` OTP). Cubre el caso del fragment-hash flow.
 */
export function AuthHashHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (typeof window === 'undefined') return;
    const rawHash = window.location.hash;
    if (!rawHash || rawHash.length < 2) return;
    const hash = new URLSearchParams(rawHash.slice(1));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    ran.current = true;

    const supabase = createSupabaseBrowserClient();
    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        // Si setSession falla, dejamos al user en la página actual con el
        // hash limpiado: no podemos hacer mucho más sin tokens válidos. El
        // siguiente paso (form de signin) podrá recuperarse.
        const nextParam = searchParams.get('next');
        const destination =
          nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
            ? nextParam
            : window.location.pathname;
        if (error) {
          window.history.replaceState(null, '', destination);
          return;
        }
        // router.replace evita una entrada en el history para la URL con hash.
        router.replace(destination);
      });
  }, [router, searchParams]);

  return null;
}
