/**
 * Marcas del campo (SVG decorativo, no interactivo). Campo COMPLETO, vertical,
 * "atacando hacia arriba" (área propia abajo, rival arriba). `viewBox 0 0 100 150`.
 *
 * Extraído de los `Pitch` idénticos que estaban duplicados en `MatchFieldEditor`
 * (F6.3) y `FormationBuilder` (F6.10), para que el renderer de diagramas (F11.5a)
 * lo reúse sin redibujarlo. El contenedor debe tener `aspect-[2/3]` (= 100×150)
 * para que `preserveAspectRatio="none"` no distorsione los elementos pintados
 * encima.
 *
 * Hueco conocido: solo existe el lienzo completo+vertical (no medio campo ni
 * orientación horizontal). Seguimiento inmediato: medio + vertical.
 */

import { cn } from '@/lib/utils';

export function FieldMarkings({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 150"
      preserveAspectRatio="none"
      className={cn('absolute inset-0 size-full', className)}
      aria-hidden
    >
      <rect x="0" y="0" width="100" height="150" fill="#15803d" />
      <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6">
        <rect x="3" y="3" width="94" height="144" />
        <line x1="3" y1="75" x2="97" y2="75" />
        <circle cx="50" cy="75" r="11" />
        {/* Área propia (abajo) y rival (arriba). */}
        <rect x="22" y="123" width="56" height="24" />
        <rect x="22" y="3" width="56" height="24" />
      </g>
    </svg>
  );
}
