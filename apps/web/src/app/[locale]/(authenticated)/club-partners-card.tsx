/**
 * V-3 — PATROCINADORES Y COLABORADORES del club en el Inicio de la web.
 *
 * Es la quinta superficie de la serie, y la única que no es la app. Server
 * component: la URL firmada del logo nace y se gasta dentro de la misma petición,
 * así que aquí sí se usa `getClubPartnersFromClient` —la que lee y firma de una vez—
 * al contrario que en la nativa, donde lo que se lee acaba en la caché de disco y una
 * firma guardada caduca en una hora.
 *
 * Si el club no tiene socios activos, NO PINTA NADA: ni tarjeta ni hueco. Un inicio
 * no es sitio para anunciar una ausencia. Y la lista se pide una sola vez aunque haya
 * dos secciones; el reparto por tipo lo hace `groupPartnersByKind`, en core.
 *
 * La GESTIÓN es de V-4 y también vive en la web. Aquí solo se lee.
 */

import { getTranslations } from 'next-intl/server';
import { Handshake } from 'lucide-react';
import {
  createSupabaseServerClient,
  getClubPartnersFromClient,
  groupPartnersByKind,
  PARTNER_KINDS,
  type ClubPartner,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export async function ClubPartnersCard({ clubId }: { clubId: string }) {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const partners = await getClubPartnersFromClient(supabase, clubId);
  if (partners.length === 0) return null;

  const t = await getTranslations('partners');
  const grupos = groupPartnersByKind(partners);

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Handshake className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {PARTNER_KINDS.map((kind) =>
          grupos[kind].length === 0 ? null : (
            <section key={kind} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(kind)}
              </h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {grupos[kind].map((p) => (
                  <PartnerItem key={p.id} partner={p} />
                ))}
              </ul>
            </section>
          ),
        )}
      </CardContent>
    </Card>
  );
}

function PartnerItem({ partner }: { partner: ClubPartner }) {
  return (
    <li>
      <a
        href={partner.url}
        target="_blank"
        // `noopener` no es cosmético: sin él, la web del socio recibe una referencia a
        // esta pestaña por `window.opener` y puede redirigirla.
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-md border border-border p-2 hover:bg-zinc-900/50"
      >
        {partner.logoUrl ? (
          // `<img>` y no `next/image`, igual que el feed de novedades y el escudo del
          // club: es una URL FIRMADA de Storage con TTL corto, y next/image la
          // optimizaría y cachearía POR URL — la copia cacheada se serviría caducada.
          // `alt=""` porque el nombre va escrito al lado: leerlo dos veces sobra.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={partner.logoUrl}
            alt=""
            className="size-11 shrink-0 rounded-md object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-md bg-zinc-800 font-bold text-muted-foreground"
          >
            {partner.name.trim().slice(0, 1).toUpperCase() || '·'}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium hover:text-misterfc-green">{partner.name}</span>
          {partner.tagline ? (
            <span className="truncate text-xs text-muted-foreground">{partner.tagline}</span>
          ) : null}
        </span>
      </a>
    </li>
  );
}
