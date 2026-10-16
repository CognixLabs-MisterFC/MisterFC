import { getTranslations } from 'next-intl/server';

/**
 * Marca de los textos que aún no ha revisado la abogada (spec §10). Va en el idioma del
 * documento al que acompaña, y se pinta encima de él.
 */
export async function LegalPendiente({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'legal_publico' });
  return (
    <p
      role="note"
      lang={locale}
      className="mb-6 rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200"
    >
      {t('pendiente_revision')}
    </p>
  );
}
