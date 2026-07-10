'use server';

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

const DOC_TYPES = [
  'privacy_policy',
  'terms_conditions',
  'image_internal',
  'image_social',
  'medical_informed_consent',
] as const;
type DocType = (typeof DOC_TYPES)[number];

export type ConvertResult = { markdown: string } | { error: string };
export type PublishResult = { version: number; published: boolean } | { error: string };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10 MB — un .docx de texto legal es de KB.

/**
 * F14-13b — Conversión .docx → markdown, SERVER-ONLY (mammoth + turndown son de
 * Node). El fichero se convierte y se DESCARTA: no se guarda en ningún bucket. La
 * publicación es un paso aparte. Gateada por admin_club (aunque no escribe en BD,
 * evitamos exponer la conversión a otros roles).
 */
export async function convertDocxToMarkdown(formData: FormData): Promise<ConvertResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'no_session' };
  if (ctx.activeClub.role !== 'admin_club') return { error: 'forbidden' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'no_file' };
  if (file.size === 0) return { error: 'empty_file' };
  if (file.size > MAX_DOCX_BYTES) return { error: 'too_large' };
  const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx');
  if (!isDocx) return { error: 'not_docx' };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const turndown = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    });
    turndown.use(gfm);
    const markdown = turndown.turndown(html).trim();
    if (!markdown) return { error: 'empty_result' };
    return { markdown };
  } catch {
    return { error: 'convert_failed' };
  }
}

/**
 * F14-13b — Publica una versión nueva del doc_type del club activo vía la RPC
 * `publish_legal_document` (SECURITY DEFINER, gate admin_club, idempotente). Usa el
 * cliente AUTENTICADO (no service_role): el gate de la RPC valida el rol con
 * auth.uid(). Devuelve la versión y si publicó (published=false = sin cambios).
 */
export async function publishLegalDocument(
  docType: DocType,
  body: string,
): Promise<PublishResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'no_session' };
  if (!DOC_TYPES.includes(docType)) return { error: 'bad_doc_type' };
  if (!body || !body.trim()) return { error: 'empty_body' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data, error } = await supabase.rpc('publish_legal_document', {
    p_club_id: ctx.activeClub.club.id,
    p_doc_type: docType,
    p_body: body,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('empty_body')) return { error: 'empty_body' };
    return { error: 'generic' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: 'generic' };
  return { version: row.version, published: row.published };
}
