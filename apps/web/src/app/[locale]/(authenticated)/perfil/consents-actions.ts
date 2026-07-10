'use server';

import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

/**
 * F14-13 — Carga el texto EXACTO que el tutor aceptó, por legal_document_id, vía
 * la RPC `get_legal_document_body` (SECURITY DEFINER, gateada por "existe un
 * consent de este tutor que lo referencia"). Devuelve null si no lo consintió o si
 * falla. Se llama desde el modal del perfil al abrir.
 */
export async function loadAcceptedLegalDocument(
  legalDocumentId: string,
): Promise<{ title: string; body: string } | null> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data, error } = await supabase.rpc('get_legal_document_body', {
    p_legal_document_id: legalDocumentId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { title: row.title, body: row.body } : null;
}
