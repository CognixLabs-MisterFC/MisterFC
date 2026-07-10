import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { FileText } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LegalDocsEditor, type LegalDocRow } from './legal-docs-editor';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14-13b — Publicación de los textos legales del club (SOLO admin_club; a
 * diferencia del resto de Ajustes, director/coordinador NO entran). Se cuelga bajo
 * /ajustes. Carga la versión vigente de cada doc_type y delega en el editor.
 */
export default async function DocumentosLegalesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo admin_club (no director, no coordinador).
  if (ctx.activeClub.role !== 'admin_club') {
    redirect(`/${locale}/ajustes`);
  }

  const t = await getTranslations('ajustes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Versión vigente (max) de cada doc_type del club. RLS legal_documents_select_own_club
  // permite leer los del club del que el admin es miembro.
  const { data } = await supabase
    .from('legal_documents')
    .select('doc_type, version, title, body')
    .eq('club_id', ctx.activeClub.club.id)
    .order('version', { ascending: false });

  const rows = data ?? [];
  const current: LegalDocRow[] = [];
  for (const r of rows) {
    if (!current.some((c) => c.doc_type === r.doc_type)) {
      current.push({ doc_type: r.doc_type, version: r.version, title: r.title, body: r.body });
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <FileText className="size-7 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('legal.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('legal.subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('legal.section_title')}</CardTitle>
          <CardDescription>{t('legal.section_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LegalDocsEditor docs={current} />
        </CardContent>
      </Card>
    </div>
  );
}
