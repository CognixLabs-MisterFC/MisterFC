/**
 * F13.10 — Cabecera de identidad del jugador, COMPARTIDA por la ficha del informe
 * (ReportFichaView), la vista staff y /mi-ficha. Pinta foto + nombre + dorsal +
 * edad/pie/posición + mini-campo SVG. Sin tarjeta envolvente ni stats (eso lo
 * añade quien la usa). Server component (necesita traducciones de posición/pie).
 */

import { getTranslations } from 'next-intl/server';
import type { PlayerPosition } from '@misterfc/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PositionField } from './position-field';

export type FichaHeaderData = {
  fullName: string;
  initials: string;
  photoUrl: string | null;
  dorsal: number | null;
  age: number | null;
  primaryPos: PlayerPosition | null;
  secondaryPos: string[];
  foot: string | null;
  /** Línea secundaria opcional (ej. "Equipo · Temporada · Periodo"). */
  subtitle?: string | null;
};

export async function FichaHeader({ data }: { data: FichaHeaderData }) {
  const t = await getTranslations('informes');
  const tPos = await getTranslations('jugadores.positions');
  const tFoot = await getTranslations('jugadores.feet');

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Avatar className="size-20 border border-border">
        {data.photoUrl ? <AvatarImage src={data.photoUrl} alt={data.fullName} /> : null}
        <AvatarFallback className="text-lg">{data.initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight">{data.fullName}</h2>
          {data.dorsal != null ? (
            <span className="rounded-md bg-misterfc-green/15 px-2 py-0.5 text-sm font-semibold text-misterfc-green">
              #{data.dorsal}
            </span>
          ) : null}
        </div>
        {data.subtitle ? (
          <p className="text-sm text-muted-foreground">{data.subtitle}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {data.age != null ? <span>{t('age', { age: data.age })}</span> : null}
          {data.primaryPos ? <span>{tPos(data.primaryPos)}</span> : null}
          {data.foot ? <span>{tFoot(data.foot)}</span> : null}
        </div>
      </div>

      <PositionField primary={data.primaryPos} secondary={data.secondaryPos} />
    </div>
  );
}
