'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { createSupabaseBrowserClient } from '@misterfc/core';
import { ResetPasswordPanel } from './reset-password-panel';

/**
 * QUE NO SE VEA "el enlace ha caducado" ANTES DE TIEMPO.
 *
 * BUG-4 — cuando el correo de recuperación sale por el flujo implícito (el de la
 * app), la sesión llega en el FRAGMENTO de la URL. El servidor no puede leerlo,
 * así que en el primer render NO hay sesión y la página, tal cual estaba, decía
 * que el enlace había caducado justo antes de que el enlace funcionase.
 *
 * Aquí se espera: primero "un momento…", y solo cuando se sabe se decide entre
 * el formulario y el aviso de caducado. Quien canjea el fragmento es
 * `AuthHashHandler` (en el layout); nosotros solo miramos si aparece sesión.
 */
const ESPERA_MAX_MS = 10_000;

type Estado = 'comprobando' | 'con_sesion' | 'caducado';

export function ResetPasswordGate({
  locale,
  children,
}: {
  locale: string;
  /** Lo que se pinta si se confirma que no hay sesión: el aviso de caducado. */
  children: ReactNode;
}) {
  const t = useTranslations('auth.reset_password');
  const [estado, setEstado] = useState<Estado>('comprobando');

  useEffect(() => {
    let vivo = true;
    const supabase = createSupabaseBrowserClient();
    // Si no hay tokens en el fragmento, no va a aparecer ninguna sesión nueva:
    // no tiene sentido esperar.
    const traeTokens = window.location.hash.includes('access_token=');

    void supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      if (data.session) {
        setEstado('con_sesion');
      } else if (!traeTokens) {
        setEstado('caducado');
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (vivo && sesion) setEstado('con_sesion');
    });

    // Cinturón: si el canje del fragmento falla, `AuthHashHandler` limpia la URL
    // y no avisa a nadie. Sin esto nos quedaríamos en "un momento…" para siempre.
    const timer = traeTokens
      ? setTimeout(() => {
          if (vivo) setEstado('caducado');
        }, ESPERA_MAX_MS)
      : undefined;

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (estado === 'con_sesion') return <ResetPasswordPanel locale={locale} />;
  if (estado === 'caducado') return <>{children}</>;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <p className="text-sm text-zinc-300">{t('checking')}</p>
    </main>
  );
}
