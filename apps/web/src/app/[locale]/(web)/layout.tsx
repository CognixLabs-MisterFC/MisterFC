import { isMarketingSiteOn } from '@misterfc/core';

/**
 * Layout de la web comercial (grupo `(web)`): portada, funciones, seguridad y demo.
 *
 * No pasa por la carcasa de la app (`(authenticated)/layout.tsx`): comparte con ella
 * solo el layout raíz de `[locale]` (html, fuente y textos). La cabecera, el pie y la
 * analítica llegan en W2 y W6.
 *
 * APAGADA (`MARKETING_SITE`), este layout no añade nada: cada página del grupo pinta lo
 * que pintaba esa URL antes de la web comercial (ver `portada/page.tsx`).
 */
export default function WebLayout({ children }: { children: React.ReactNode }) {
  if (!isMarketingSiteOn(process.env)) return children;
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-misterfc-navy">{children}</div>
  );
}
