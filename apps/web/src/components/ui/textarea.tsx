import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Textarea siguiendo los tokens del shadcn Input (`border-input`,
 * `bg-transparent`, `text-foreground`, `placeholder:text-muted-foreground`)
 * para que en dark mode el texto que se escribe se vea — el bug original
 * con clases zinc-* directas era que el `<textarea>` heredaba el color del
 * sistema (no del padre) y se quedaba negro sobre fondo oscuro.
 */
function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
