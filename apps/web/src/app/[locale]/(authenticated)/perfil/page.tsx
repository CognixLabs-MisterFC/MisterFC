import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { initialsOf } from '@/components/shell/avatar-image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AvatarUploader } from './avatar-uploader';
import { PerfilForm } from './perfil-form';

type Props = {
  params: Promise<{ locale: string }>;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function PerfilPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) {
    redirect(`/${locale}/signin`);
  }

  const t = await getTranslations('perfil');

  const fallback = initialsOf(
    ctx.profile.full_name,
    ctx.user.email ?? '?'
  );

  let avatarSignedUrl: string | null = null;
  if (ctx.profile.avatar_url) {
    const adapter = await createCookieAdapter();
    const supabase = createSupabaseServerClient(adapter);
    const { data } = await supabase.storage
      .from('profile-avatars')
      .createSignedUrl(ctx.profile.avatar_url, SIGNED_URL_TTL_SECONDS);
    avatarSignedUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('section.avatar')}</CardTitle>
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
          <CardTitle>{t('section.data')}</CardTitle>
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
          <CardTitle>{t('section.account')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">{t('field.email')}</p>
            <p className="text-muted-foreground">{ctx.user.email}</p>
          </div>
          <Separator />
          <a
            href={`/${locale}/forgot-password`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {t('change_password')}
          </a>
          <Separator />
          <a
            href={`/${locale}/perfil/notificaciones`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {t('manage_notifications')}
          </a>
          <Separator />
          <a
            href={`/${locale}/perfil/formaciones`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {t('manage_formations')}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
