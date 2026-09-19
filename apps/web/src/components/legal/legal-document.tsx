import { getTranslations } from 'next-intl/server';
import { LegalMarkdown } from './legal-markdown';
import { readLegalDoc, type LegalSlug } from '@/lib/legal-content';

/**
 * C-1 — Cuerpo de una página legal pública. Existe para que el aviso y el
 * `lang` no se repitan (ni se olviden) en las tres páginas.
 *
 * El documento es el del abogado y está en CASTELLANO en los tres idiomas. Dos
 * consecuencias que se tratan aquí:
 *
 *  · El aviso, en el idioma de QUIEN LEE. Decirle en castellano a un inglés que
 *    el texto está en castellano no le sirve de nada.
 *  · `lang="es"` en el documento, y solo en el documento. Sin esto un lector de
 *    pantalla en inglés lee español con voz inglesa —ininteligible— y la página
 *    miente sobre su idioma (`<html lang="en">` con cuerpo español). El aviso
 *    queda FUERA del `lang`, porque ese sí va en el idioma del lector.
 */
export async function LegalDocument({
  slug,
  locale,
}: {
  slug: LegalSlug;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'legal_publico' });

  return (
    <>
      {locale !== 'es' && (
        <p className="mb-6 rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
          {t('solo_castellano')}
        </p>
      )}
      <div lang="es">
        <LegalMarkdown body={readLegalDoc(slug)} />
      </div>
    </>
  );
}
