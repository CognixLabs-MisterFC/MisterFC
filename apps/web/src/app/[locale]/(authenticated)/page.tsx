import { setRequestLocale, getTranslations } from 'next-intl/server';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El layout ya garantiza que ctx existe. Lo recuperamos para mostrar info.
  const ctx = await loadShellContext();
  const t = await getTranslations('home');
  const tRoles = await getTranslations('roles');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t('welcome', { club: ctx?.activeClub.club.name ?? '' })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('your_role', { role: tRoles(ctx?.activeClub.role ?? 'jugador') })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('next_steps_title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>{t('next_steps_body')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
