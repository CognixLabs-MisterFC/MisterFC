'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { LegalMarkdown } from './legal-markdown';

type LoadedDoc = { title: string; body: string };

type Props = {
  open: boolean;
  /** Título a mostrar en la cabecera (siempre disponible). */
  title: string | null;
  /** Body ya cargado (flujo de alta / re-consentimiento). */
  body?: string | null;
  /**
   * Carga perezosa del body (perfil: se pide por legal_document_id al abrir). Si
   * se pasa `body` no se usa. Debe devolver null si no se pudo cargar.
   */
  fetchBody?: () => Promise<LoadedDoc | null>;
  closeLabel: string;
  errorLabel: string;
  onClose: () => void;
};

/**
 * F14-13 — Modal reutilizable para ver un texto legal. Extrae el patrón antes
 * duplicado en consent-gate / child-image-cards / reconsent-form, y renderiza el
 * body como MARKDOWN (LegalMarkdown) en vez de texto plano. Dos modos:
 *   · body precargado → lo pinta directo.
 *   · fetchBody → lo carga al abrir (spinner mientras); útil para servir el texto
 *     EXACTO firmado por legal_document_id.
 */
export function LegalTextModal({
  open,
  title,
  body,
  fetchBody,
  closeLabel,
  errorLabel,
  onClose,
}: Props) {
  // Solo se pide body cuando el modal está abierto, no viene precargado y hay
  // loader (modo perfil). El padre remonta con `key` por id, así que el estado
  // inicial (vía initializer, no setState-in-effect) es correcto por documento.
  const willFetch = open && body == null && fetchBody != null;
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null);
  const [loading, setLoading] = useState(willFetch);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!willFetch || !fetchBody) return;
    let alive = true;
    fetchBody()
      .then((doc) => {
        if (!alive) return;
        if (doc) setLoaded(doc);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [willFetch, fetchBody]);

  if (!open) return null;

  const shownTitle = title ?? loaded?.title ?? '';
  const shownBody = body ?? loaded?.body ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-lg border border-zinc-700 bg-[#0F1B2E] p-5 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">{shownTitle}</h2>
        <div className="overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </div>
          ) : failed || shownBody == null ? (
            <p className="py-6 text-sm text-destructive">{errorLabel}</p>
          ) : (
            <LegalMarkdown body={shownBody} />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-md bg-misterfc-green px-3 py-1.5 text-sm font-semibold text-zinc-900 transition hover:bg-[#0EA371]"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
