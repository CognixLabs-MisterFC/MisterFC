/**
 * Marca de los textos que aún no ha revisado la abogada (spec §10). Va en castellano,
 * como el documento al que acompaña, y se pinta encima de él.
 */
export function LegalPendiente() {
  return (
    <p
      role="note"
      lang="es"
      className="mb-6 rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200"
    >
      Pendiente: revisión de este texto por un abogado
    </p>
  );
}
