'use client';

/**
 * ChipGroup — multi-select por chips toggle (aria-pressed). Extraído del
 * formulario de ejercicios (F11.6) para reusarlo en la cabecera de sesión (F12.2)
 * y donde haga falta seleccionar varios valores de un vocabulario fijo.
 */

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type ChipGroupProps = {
  label: string;
  /** Texto de ayuda opcional bajo la etiqueta. */
  description?: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor: (value: string) => string;
};

export function ChipGroup({
  label,
  description,
  options,
  selected,
  onToggle,
  labelFor,
}: ChipGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {description ? <p className="-mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(opt)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:border-foreground/40'
              )}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
