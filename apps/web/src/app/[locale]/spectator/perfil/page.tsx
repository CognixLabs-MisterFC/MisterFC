import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadSpectatorContext } from '@/lib/spectator-shell';
import { initialsOf } from '@/components/shell/avatar-image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AvatarUploader } from '@/app/[locale]/(authenticated)/perfil/avatar-uploader';
import { PerfilForm } from '@/app/[locale]/(authenticated)/perfil/perfil-form';

type Props = { params: Promise<{ locale: string }> };

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * F14C-4 — PERFIL MÍNIMO del seguidor. REUTILIZA AvatarUploader + PerfilForm
 * (globales, sin club). SIN la sección de consentimientos de tutor (que asume
 * club activo) ni el enlace a notificaciones (ruta de miembro). Datos: avatar,
 * nombre/fecha/idioma, email, cambiar contraseña. Cerrar sesión va en el menú
 * de usuario de la cabecera.
 */
export default async function SpectatorPerfilPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadSpectatorContext();
  if (!ctx) redirect(`/${locale}/`);

  const t = await getTranslations('spectator');
  const tPerfil = await getTranslations('perfil');
  const fallback = initialsOf(ctx.profile.full_name, ctx.user.email ?? '?');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  let avatarSignedUrl: string | null = null;
  if (ctx.profile.avatar_url) {
    const { data } = await supabase.storage
      .from('profile-avatars')
      .createSignedUrl(ctx.profile.avatar_url, SIGNED_URL_TTL_SECONDS);
    avatarSignedUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t('perfil.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('perfil.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tPerfil('section.avatar')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AvatarUploader
            userId={ctx.user.id}
            initialPath={ctx.profile.avatar_url}
            initialSignedUrl={avatarSignedUrl}
            fallback={fallback}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tPerfil('section.data')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PerfilForm
            locale={locale}
            email={ctx.user.email ?? ''}
            initial={{
              full_name: ctx.profile.full_name ?? '',
              date_of_birth: ctx.profile.date_of_birth ?? '',
              locale: ctx.profile.locale,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tPerfil('section.account')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">{tPerfil('field.email')}</p>
            <p className="text-muted-foreground">{ctx.user.email}</p>
          </div>
          <Separator />
          <a
            href={`/${locale}/forgot-password`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {tPerfil('change_password')}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
