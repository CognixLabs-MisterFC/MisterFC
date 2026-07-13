import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Rejilla de tarjetas de una página-HUB (Entrenamientos / Partidos / Plantilla).
 * Presentacional puro (server): recibe los items YA resueltos y localizados, y
 * enlaza a las rutas existentes (los hubs no mueven rutas). El gating se aplica
 * antes (qué items llegan); aquí solo se pintan.
 */
export type HubGridItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  title: string;
  /** Descripción opcional (2ª línea). Los hubs siempre la pasan; otros usos
   * (p.ej. las Acciones de equipo) pueden omitirla para tarjetas de una línea. */
  description?: string;
};

/**
 * Rejilla de tarjetas-rectángulo (icono + título [+ descripción] + chevron).
 * Extraída de HubGrid para reutilizar el MISMO patrón visual fuera de las
 * páginas-hub (F14E-3: bloque "Acciones" de la ficha de equipo). Presentacional.
 */
export function HubGridCards({ items }: { items: HubGridItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Card key={it.key} className="transition-colors hover:border-foreground/30">
            <Link href={it.href} className="block">
              <CardContent className="flex items-center gap-4 py-5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-5 text-foreground" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{it.title}</p>
                  {it.description && (
                    <p className="text-sm text-muted-foreground">{it.description}</p>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </CardContent>
            </Link>
          </Card>
        );
      })}
    </div>
  );
}

export function HubGrid({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: HubGridItem[];
}) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <HubGridCards items={items} />
    </div>
  );
}
