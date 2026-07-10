import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { getActiveSeasonLabel } from '@/lib/active-season';
import {
  loadCurrentLegalDocs,
  loadImageLegalDocs,
  loadMedicalLegalDoc,
} from '../invite/[token]/consent-data';
import { ReconsentForm, type ReconsentChild } from './reconsent-form';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14-5 — Pantalla de RE-CONSENTIMIENTO por temporada. Vive FUERA del grupo
 * (authenticated) a propósito: el gate del layout autenticado redirige aquí, y al
 * no estar bajo ese layout no se produce bucle. Solo llegan tutores que realmente
 * lo necesitan; el resto se devuelve a la app.
 */
export default async function ReconsentPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // F14-14 — QUÉ doc_types debe (re)firmar este tutor (obligatorios + opcionales).
  // Si no hay ninguno pendiente → nada que hacer, de vuelta a la app. Si solo hay
  // opcionales, la pantalla se muestra pero NO bloquea (puede salir sin firmar).
  const { data: pendingData } = await supabase.rpc('tutor_pending_reconsent_docs', {
    p_club_id: clubId,
  });
  const pending = new Set((pendingData ?? []) as string[]);
  if (pending.size === 0) redirect(`/${locale}`);

  const blocking = pending.has('terms_conditions') || pending.has('privacy_policy');

  // Hijos del tutor (parent/guardian) en el club activo.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('relation, players!inner(id, club_id, first_name, last_name)')
    .eq('profile_id', ctx.user.id);
  type PA = {
    relation: string;
    players: { id: string; club_id: string; first_name: string; last_name: string | null };
  };
  const players: ReconsentChild[] = ((pas ?? []) as unknown as PA[])
    .filter((p) => ['parent', 'guardian'].includes(p.relation) && p.players.club_id === clubId)
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
    }));

  const [{ terms, privacy }, imageDocs, medicalDoc, seasonLabel] = await Promise.all([
    loadCurrentLegalDocs(clubId),
    loadImageLegalDocs(clubId),
    loadMedicalLegalDoc(clubId),
    getActiveSeasonLabel(supabase, clubId),
  ]);

  const toText = (d: { title: string; body: string } | null) =>
    d ? { title: d.title, body: d.body } : null;

  // F14-14 — solo se pintan los doc_types PENDIENTES (re-firma selectiva). Un doc
  // que no cambió no aparece. Los opcionales son por hijo; el helper devuelve el
  // doc_type en agregado (pendiente para algún hijo) y la pantalla lo ofrece a
  // todos los hijos, como en el rollover.
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A1220] px-4 py-10">
      <ReconsentForm
        locale={locale}
        seasonLabel={seasonLabel}
        blocking={blocking}
        terms={pending.has('terms_conditions') ? toText(terms) : null}
        privacy={pending.has('privacy_policy') ? toText(privacy) : null}
        internalDoc={pending.has('image_internal') ? toText(imageDocs.internal) : null}
        socialDoc={pending.has('image_social') ? toText(imageDocs.social) : null}
        medicalDoc={pending.has('medical_informed_consent') ? toText(medicalDoc) : null}
        players={players}
      />
    </main>
  );
}
