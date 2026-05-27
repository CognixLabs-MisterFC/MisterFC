import { setRequestLocale, getTranslations } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <h1 className="text-6xl font-bold tracking-tight text-[#10B981]">{t('app_name')}</h1>
      <p className="mt-4 max-w-md text-base text-zinc-300">{t('tagline')}</p>
      <p className="mt-12 text-xs uppercase tracking-widest text-zinc-500">{t('footer')}</p>
    </main>
  );
}
