import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient, getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { ClubLogo } from '@/components/ui/club-logo';
import { ClubLoginForm } from './club-login-form';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

type PublicClub = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
};

/**
 * F14J-3b — Login por club en misterfc.es/{slug} (5B). Última pieza de F14J.
 *
 * `[slug]` es el ÚNICO segmento dinámico directo bajo `[locale]`; Next resuelve
 * estático ANTES que dinámico, así que /clubes, /signin, etc. siguen sirviendo su
 * página y aquí solo caen los slugs "libres". La blocklist de 3a impide crear un
 * club con un slug que colisione con una ruta.
 *
 *   · Con sesión abierta → directo a la app (/{locale}), como J-2.
 *   · Sin sesión: resuelve el club por slug con `get_public_club_by_slug` (RPC
 *     público F14J-1). 0 filas / error → "club no encontrado". Slug válido →
 *     LOGO del club en grande + formulario de login (form 3b).
 */
export default async function ClubLoginPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();

  // Ya logueado → a la app (no re-preguntar), igual que J-2 y /signin.
  const user = await getCurrentUser(adapter);
  if (user) {
    redirect(`/${locale}`);
  }

  // Resolución PÚBLICA del club (anon): el RPC está concedido a anon.
  const supabase = createSupabaseServerClient(adapter);
  const { data, error } = await supabase.rpc('get_public_club_by_slug', {
    p_slug: slug,
  });
  const club = ((data ?? []) as PublicClub[])[0];

  const tc = await getTranslations('clubLogin');

  // Slug inexistente (0 filas) o fallo del RPC → "club no encontrado".
  if (error || !club) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <h1 className="text-2xl font-bold text-white">{tc('notFoundTitle')}</h1>
          <p className="text-sm text-zinc-300">{tc('notFoundBody')}</p>
          <Link
            href={`/${locale}/clubes`}
            className="text-sm text-[#10B981] underline underline-offset-4 hover:text-white"
          >
            {tc('backToClubs')}
          </Link>
        </div>
      </main>
    );
  }

  const t = await getTranslations('auth.signin');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 text-center text-white">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        {/* El logo es el protagonista. */}
        <div className="flex flex-col items-center gap-4">
          <ClubLogo
            path={club.logo_path}
            name={club.name}
            className="size-28 text-4xl"
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-white">{club.name}</h1>
            <p className="text-sm text-zinc-300">{tc('subtitle')}</p>
          </div>
        </div>

        <ClubLoginForm locale={locale} clubId={club.id} />

        <Link
          href={`/${locale}/forgot-password`}
          className="text-sm text-zinc-400 underline underline-offset-4 hover:text-white"
        >
          {t('forgot_password_link')}
        </Link>
      </div>
    </main>
  );
}
