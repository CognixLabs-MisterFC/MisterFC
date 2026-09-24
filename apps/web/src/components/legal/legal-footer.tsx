import Link from 'next/link';

/**
 * Pie legal para las páginas PÚBLICAS sin sesión (portada de clubes y signin) —
 * lo que ve alguien sin cuenta, incluido un revisor de tienda. Enlaza las CUATRO
 * páginas legales de Cognix Labs. No se usa en el chrome de la app autenticada.
 *
 * El desistimiento entra aquí porque este pie es la única lista de legales que se
 * alcanza SIN CUENTA: el muro de pago la pide antes de pagar y Perfil después, pero
 * las dos exigen sesión. Sin esta cuarta entrada, el formulario no era alcanzable
 * desde ninguna superficie pública, que es donde lo busca quien aún no ha entrado.
 *
 * Etiquetas escritas en castellano, como en el pie de `legal/layout.tsx` y por el
 * mismo motivo: los documentos que enlaza SOLO existen en castellano.
 */
const LINKS = [
  { slug: 'privacidad', label: 'Privacidad' },
  { slug: 'terminos', label: 'Términos' },
  { slug: 'eliminacion-cuenta', label: 'Eliminación de cuenta' },
  { slug: 'desistimiento', label: 'Desistimiento' },
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
