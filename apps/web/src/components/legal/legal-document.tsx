import { getTranslations } from 'next-intl/server';
import { LegalMarkdown } from './legal-markdown';
import { LEGAL_PENDIENTES_REVISION, readLegalDoc, type LegalSlug } from '@/lib/legal-content';
import { LegalPendiente } from './legal-pendiente';

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
      {LEGAL_PENDIENTES_REVISION.includes(slug) && <LegalPendiente />}
      <div lang="es">
        <LegalMarkdown body={readLegalDoc(slug)} />
      </div>
    </>
  );
}

/**
 * Un apartado que se añade al final de otro documento (el 17 de la privacidad, para la
 * web comercial). Sin el aviso de idioma, que ya lleva el documento al que se añade.
 */
export function LegalAnexo({ slug }: { slug: LegalSlug }) {
  return (
    <section className="mt-10 border-t border-zinc-700 pt-8">
      {LEGAL_PENDIENTES_REVISION.includes(slug) && <LegalPendiente />}
      <div lang="es">
        <LegalMarkdown body={readLegalDoc(slug)} />
      </div>
    </section>
  );
}
