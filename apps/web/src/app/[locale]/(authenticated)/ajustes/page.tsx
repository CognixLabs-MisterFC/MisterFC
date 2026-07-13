import { redirect } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Settings, FileText, ChevronRight } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ClubSettingsForm } from './club-settings-form';
import { ClubLogoUploader } from './club-logo-uploader';

type Props = {
  params: Promise<{ locale: string }>;
};

// F14E-1 — Admin y coordinador ven la pantalla; el DIRECTOR pierde el acceso
// (revocado en menú y aquí). El superadmin entra como admin_club sintético →
// paridad. SOLO admin puede cambiar el flag (D10).
const ALLOWED_ROLES = new Set<string>(['admin_club', 'coordinador']);

export default async function AjustesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (!ALLOWED_ROLES.has(ctx.activeClub.role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('ajustes');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Sin fila en club_settings = OFF (privacidad por defecto, D4).
  const { data: settings } = await supabase
    .from('club_settings')
    .select('evaluations_player_visibility')
    .eq('club_id', ctx.activeClub.club.id)
    .maybeSingle();

  const visible = settings?.evaluations_player_visibility ?? false;
  const canEdit = ctx.activeClub.role === 'admin_club';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Settings className="size-7 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('evaluations_section.title')}</CardTitle>
          <CardDescription>{t('evaluations_section.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ClubSettingsForm initialVisible={visible} canEdit={canEdit} />
        </CardContent>
      </Card>

      {/* F14B-9a — Logo del club: SOLO admin_club (director NO; superadmin sí, paridad). */}
      {ctx.activeClub.role === 'admin_club' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('logo.section_title')}</CardTitle>
            <CardDescription>{t('logo.section_description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ClubLogoUploader
              clubId={ctx.activeClub.club.id}
              clubName={ctx.activeClub.club.name}
              initialPath={ctx.activeClub.club.logo_path}
            />
          </CardContent>
        </Card>
      )}

      {/* F14-13b — Publicación de textos legales: SOLO admin_club. */}
      {ctx.activeClub.role === 'admin_club' && (
        <Link href={`/${locale}/ajustes/documentos-legales`} className="block">
          <Card className="transition hover:border-misterfc-green/50">
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              <FileText className="size-5 text-muted-foreground" aria-hidden />
              <div className="flex-1">
                <CardTitle>{t('legal.section_title')}</CardTitle>
                <CardDescription>{t('legal.section_description')}</CardDescription>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </CardHeader>
          </Card>
        </Link>
      )}
    </div>
  );
}
