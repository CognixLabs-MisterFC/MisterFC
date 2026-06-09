'use client';

/**
 * #9 — Botón para COLAPSAR / MOSTRAR el menú lateral (global, sirve para el
 * directo y cualquier pantalla). Patrón idéntico al de un theme-toggle: el shell
 * server-renderiza el estado inicial desde la cookie (sin flash de hidratación);
 * este botón alterna el atributo `data-sidebar-collapsed` del root del shell y
 * persiste la elección en una cookie SSR-friendly. Solo desktop (lg+): en móvil
 * el menú es el drawer (MobileDrawer), que no se toca.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export const SIDEBAR_COLLAPSED_COOKIE = 'mfc_sidebar_collapsed';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function SidebarToggle({ initialCollapsed }: { initialCollapsed: boolean }) {
  const t = useTranslations('shell');
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Fuente de verdad del SSR = la cookie; el atributo del root aplica el cambio
    // al instante sin re-render del servidor (el aside se oculta vía CSS).
    const root = document.getElementById('app-shell-root');
    if (root) root.dataset.sidebarCollapsed = next ? 'true' : 'false';
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? '1' : '0'}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }

  const label = collapsed ? t('expand_sidebar') : t('collapse_sidebar');

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={collapsed}
      aria-label={label}
      title={label}
      className="hidden items-center justify-center rounded-md p-2 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 lg:inline-flex"
    >
      {collapsed ? (
        <PanelLeftOpen className="size-5" aria-hidden />
      ) : (
        <PanelLeftClose className="size-5" aria-hidden />
      )}
    </button>
  );
}
