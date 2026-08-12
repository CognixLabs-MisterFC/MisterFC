import Link from 'next/link';

/**
 * Pie legal para las páginas PÚBLICAS sin sesión (portada de clubes y signin) —
 * lo que ve alguien sin cuenta, incluido un revisor de tienda. Enlaza las tres
 * páginas legales de Cognix Labs. No se usa en el chrome de la app autenticada.
 */
const LINKS = [
  { slug: 'privacidad', label: 'Privacidad' },
  { slug: 'terminos', label: 'Términos' },
  { slug: 'eliminacion-cuenta', label: 'Eliminación de cuenta' },
] as const;

export function LegalFooter({ locale }: { locale: string }) {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-zinc-400">
      {LINKS.map((l) => (
        <Link
          key={l.slug}
          href={`/${locale}/legal/${l.slug}`}
          className="underline underline-offset-2 hover:text-zinc-200"
        >
          {l.label}
        </Link>
      ))}
    </footer>
  );
}
