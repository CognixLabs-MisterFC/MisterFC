import Link from 'next/link';
import type { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';

/**
 * Layout PÚBLICO de las páginas legales de Cognix Labs (fuera del grupo
 * (authenticated) → sin sesión). Panel oscuro (mismo #0F1B2E que el modal legal
 * de F14-13) para que `LegalMarkdown` —estilizado para fondo oscuro— quede legible
 * sin tocar el componente compartido. Pie con enlaces cruzados entre las tres.
 */
const PAGES = [
  { slug: 'privacidad', label: 'Política de Privacidad' },
  { slug: 'terminos', label: 'Términos y Condiciones' },
  { slug: 'eliminacion-cuenta', label: 'Eliminación de cuenta' },
] as const;

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="min-h-screen bg-[#0F1B2E] text-zinc-300">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-10">
        <article className="flex-1">{children}</article>

        <nav className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-700 pt-5 text-sm">
          {PAGES.map((p) => (
            <Link
              key={p.slug}
              href={`/${locale}/legal/${p.slug}`}
              className="text-misterfc-green underline underline-offset-2 hover:text-emerald-300"
            >
              {p.label}
            </Link>
          ))}
          <Link
            href={`/${locale}/clubes`}
            className="ml-auto text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            Volver
          </Link>
        </nav>
      </div>
    </main>
  );
}
