import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createSupabaseServerClient, getCurrentUser } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { ClubLogo } from '@/components/ui/club-logo';

type Props = {
  params: Promise<{ locale: string }>;
};

type PublicClub = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
};

/**
 * F14J-2 — Portada pública "elige tu club" (5A).
 *
 * Es lo que ve un usuario SIN sesión al entrar a misterfc.es: la rejilla de
 * logos de TODOS los clubes (RPC público `list_public_clubs`, sin auth). Cada
 * logo enlaza a `/{slug}` (login del club, 5B — lo construye J-3).
 *
 * Con sesión NO se muestra: redirige directo a la app (`/{locale}`), igual que
 * hace /signin. La raíz sin sesión llega aquí vía el middleware (F14J-2).
 */
export default async function PortadaClubesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (user) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('portada');

  // Lectura pública (anon): el cliente sin sesión ejecuta el RPC concedido a anon.
  const supabase = createSupabaseServerClient(adapter);
  const { data, error } = await supabase.rpc('list_public_clubs');
  const clubs = (data ?? []) as PublicClub[];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0F1B2E] px-6 py-16 text-center text-white">
      <div className="flex w-full max-w-3xl flex-col items-center gap-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-[#10B981] sm:text-4xl">
            {t('title')}
          </h1>
          <p className="text-sm text-zinc-300">{t('subtitle')}</p>
        </div>

        {error ? (
          <p className="text-sm text-zinc-400">{t('error')}</p>
        ) : clubs.length === 0 ? (
          <p className="text-sm text-zinc-400">{t('empty')}</p>
        ) : (
          <ul className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {clubs.map((club) => (
              <li key={club.id}>
                {/* Enlace a misterfc.es/{slug} (login del club, 5B). La ruta la
                    crea J-3; de momento el href queda construido. Anchor plano
                    para respetar el path SIN prefijo de locale del diseño. */}
                <a
                  href={`/${club.slug}`}
                  className="group flex h-full flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-[#10B981]/50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]"
                >
                  <ClubLogo
                    path={club.logo_path}
                    name={club.name}
                    className="size-16 text-lg"
                  />
                  <span className="line-clamp-2 text-sm font-medium text-white">
                    {club.name}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
