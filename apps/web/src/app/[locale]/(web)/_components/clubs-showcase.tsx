import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { showcaseClubs } from '@misterfc/core';
import { SHOWCASE_CLUBS } from '@/lib/web/showcase';

/**
 * Apartado de clubes (spec §7.2). Con la configuración por defecto devuelve `null`: no
 * pinta título, hueco ni «próximamente». La decisión está en core (`showcaseClubs`).
 */
export async function ClubsShowcase() {
  const clubs = showcaseClubs(process.env, SHOWCASE_CLUBS);
  if (clubs.length === 0) return null;
  const t = await getTranslations('webComercial.portada.showcase');

  return (
    <section
      aria-labelledby="clubes-titulo"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6"
    >
      <h2 id="clubes-titulo" className="text-2xl font-bold sm:text-3xl">
        {t('titulo')}
      </h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((c) => (
          <li key={c.nombre} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-6">
            <Image
              src={c.logo}
              alt={c.nombre}
              width={64}
              height={64}
              className="h-16 w-16 object-contain"
            />
            {c.cita && <blockquote className="text-zinc-700">«{c.cita}»</blockquote>}
            {c.autor && <p className="text-sm text-zinc-500">{c.autor}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
