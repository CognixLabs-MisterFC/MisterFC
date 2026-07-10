'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * F14-13 — Render de los textos legales (markdown) con estilos sobrios y legibles.
 * Reemplaza el `whitespace-pre-wrap` crudo que se usaba en el flujo legal (alta,
 * re-consentimiento) y en la nueva sección del perfil. Pensado para ir dentro del
 * panel oscuro de `LegalTextModal`. Soporta GFM (tablas) porque los documentos las
 * usan.
 */
export function LegalMarkdown({ body }: { body: string }) {
  return (
    <div className="text-sm leading-relaxed text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-base font-bold text-white first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-sm font-bold text-white first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-100 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-misterfc-green underline underline-offset-2 hover:text-emerald-300"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-zinc-700" />,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-zinc-600 pl-3 text-zinc-400">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-zinc-700 px-2 py-1 text-left font-semibold text-zinc-100">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-zinc-700 px-2 py-1 align-top">{children}</td>
          ),
          code: ({ children }) => (
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-100">{children}</code>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
