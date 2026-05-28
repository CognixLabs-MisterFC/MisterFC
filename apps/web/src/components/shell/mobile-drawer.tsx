'use client';

import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

type Props = {
  triggerLabel: string;
  title: string;
  children: ReactNode;
};

/**
 * Drawer móvil. El trigger (botón hamburguesa) solo aparece en
 * pantallas menores a `lg` (clase `lg:hidden`).
 */
export function MobileDrawer({ triggerLabel, title, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={triggerLabel}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 border-r border-zinc-800 bg-zinc-950 p-0 text-zinc-100"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div onClick={() => setOpen(false)}>{children}</div>
      </SheetContent>
    </Sheet>
  );
}
