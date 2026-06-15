/**
 * Marcas del campo (SVG decorativo, no interactivo), "atacando hacia arriba".
 *
 * Lienzos soportados:
 *   - `completo` + `vertical`: campo entero. `viewBox 0 0 100 150` (área propia
 *     abajo, rival arriba).
 *   - `medio` + `vertical`: MITAD del campo atacante (la mitad superior del
 *     completo). `viewBox 0 0 100 75` (ancho completo, media longitud): portería
 *     arriba (línea de gol = arista superior, como en el completo, que tampoco
 *     pinta portería), línea de medio campo en el borde inferior. Sus marcas se
 *     DERIVAN de la mitad superior del completo (área rival, arco del círculo
 *     central apoyado en el borde inferior).
 *
 * Extraído de los `Pitch` idénticos que estaban duplicados en `MatchFieldEditor`
 * (F6.3) y `FormationBuilder` (F6.10), para que el renderer de diagramas (F11.5a)
 * lo reúse sin redibujarlo. El contenedor debe tener el aspect-ratio del lienzo
 * (`2/3` completo, `4/3` medio) para que `preserveAspectRatio="none"` no
 * distorsione los elementos pintados encima.
 *
 * Hueco conocido: orientación `horizontal` (ambos kinds) todavía no se pinta.
 */

import { cn } from '@/lib/utils';

type FieldMarkingsProps = {
  /** Mitad o campo completo. Por defecto `completo` (compat. con F6). */
  kind?: 'completo' | 'medio';
  className?: string;
};

export function FieldMarkings({ kind = 'completo', className }: FieldMarkingsProps) {
  if (kind === 'medio') {
    // Mitad superior del completo (y ∈ [0, 75]). El borde inferior es la línea de
    // medio campo; el círculo central (cx=50 cy=75 r=11) queda con el centro en el
    // borde inferior → solo se ve su mitad superior = arco apoyado en el borde.
    return (
      <svg
        viewBox="0 0 100 75"
        preserveAspectRatio="none"
        className={cn('absolute inset-0 size-full', className)}
        aria-hidden
      >
        <rect x="0" y="0" width="100" height="75" fill="#15803d" />
        <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6">
          {/* Borde: arista superior + laterales. La inferior es la línea de medio
              campo (= arista inferior del lienzo). */}
          <line x1="3" y1="3" x2="97" y2="3" />
          <line x1="3" y1="3" x2="3" y2="75" />
          <line x1="97" y1="3" x2="97" y2="75" />
          <line x1="3" y1="75" x2="97" y2="75" />
          {/* Arco del círculo central apoyado en el borde inferior. */}
          <circle cx="50" cy="75" r="11" />
          {/* Área (la del área rival del completo, arriba). */}
          <rect x="22" y="3" width="56" height="24" />
        </g>
      </svg>
    );
  }

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
