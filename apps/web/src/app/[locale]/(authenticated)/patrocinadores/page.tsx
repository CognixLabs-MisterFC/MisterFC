import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Handshake } from 'lucide-react';
import {
  createSupabaseServerClient,
  canManageClubPartners,
  getClubPartnersForManageFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { PartnersManager } from './partners-manager';

type Props = { params: Promise<{ locale: string }> };

/**
 * V-4 — GESTIÓN de patrocinadores y colaboradores. Solo web: en la app son de lectura.
 *
 * ── POR QUÉ NO ESTÁ DENTRO DE /ajustes ──────────────────────────────────────
 * Era el sitio natural, y no cabe: `/ajustes` está abierto a admin_club y coordinador
 * y le REVOCA el acceso al DIRECTOR a propósito (F14E-1, en el menú y en el guard).
 * Los socios los gestionan admin y director, que es justo el par contrario. Colgarlo
 * de ahí obligaba a relajar la puerta de ajustes —y con ella los textos legales y las
 * supresiones— o a dejar fuera al director. Ruta propia, puerta propia.
 *
 * El guard usa `canManageClubPartners`, la misma función que decide si la app pinta
 * algo de gestión y el espejo en pantalla de `user_is_admin_or_director`, que es quien
 * de verdad manda en la RLS. El superadmin entra porque el chokepoint le devuelve
 * 'admin_club' en cualquier club.
 */
export default async function PatrocinadoresPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!canManageClubPartners(ctx.activeClub.role)) redirect(`/${locale}`);

  const t = await getTranslations('partners');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // Esta lectura SÍ trae los retirados: hay que poder devolverlos.
  const partners = await getClubPartnersForManageFromClient(supabase, ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Handshake className="size-7 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('manage.subtitle')}</p>
        </div>
      </div>

      <PartnersManager clubId={ctx.activeClub.club.id} initial={partners} />
    </div>
  );
}
