import { isMarketingSiteOn, getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { SiteHeader } from '@/components/web/site-header';
import { SiteFooter } from '@/components/web/site-footer';

/**
 * Layout de la web comercial (grupo `(web)`): portada, funciones, seguridad y demo.
 *
 * No pasa por la carcasa de la app (`(authenticated)/layout.tsx`): comparte con ella
 * solo el layout raíz de `[locale]` (html, fuente y textos). Pone la cabecera y el pie
 * (W2).
 *
 * La sesión solo se mira para el enlace de la cabecera («Acceso clubes» o «Ir a mi
 * club», spec §3.3). No protege nada: todas estas páginas son públicas.
 *
 * Vercel Web Analytics está configurado en el layout raíz (`[locale]/layout.tsx`), no
 * pone cookies. Hay que activarla en el panel de Vercel; sin eso, el script no manda
 * nada.
 *
 * APAGADA (`MARKETING_SITE`), este layout no añade nada ni consulta la sesión: cada
 * página del grupo pinta lo que pintaba esa URL antes de la web comercial (ver
 * `portada/page.tsx`).
 */
export default async function WebLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  if (!isMarketingSiteOn(process.env)) return children;
  const { locale } = await params;
  const user = await getCurrentUser(await createCookieAdapter());

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-misterfc-navy">
      <SiteHeader locale={locale} signedIn={user !== null} />
      {children}
      <SiteFooter locale={locale} />
    </div>
  );
}
