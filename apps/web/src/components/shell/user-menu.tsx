'use client';

import type { ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  /** Avatar como ReactNode para que el server lo renderice con la signed URL. */
  avatar: ReactNode;
  fullName: string | null;
  email: string;
  labels: {
    menu_label: string;
    perfil: string;
    signout: string;
  };
  /** El form de logout es server-action; lo recibimos como children renderizado. */
  signoutForm: ReactNode;
  /**
   * F14C-4 — destino del enlace "Mi perfil". Por defecto `/perfil` (shell de
   * miembro, sin cambios). El shell del seguidor lo apunta a `/spectator/perfil`.
   */
  perfilHref?: string;
};

export function UserMenu({
  avatar,
  fullName,
  email,
  labels,
  signoutForm,
  perfilHref = '/perfil',
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full p-0"
          aria-label={labels.menu_label}
        >
          {avatar}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          {fullName && <span className="truncate font-medium">{fullName}</span>}
          <span className="truncate text-xs font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={perfilHref} className="flex items-center gap-2">
            <UserRound className="size-4" aria-hidden />
            <span>{labels.perfil}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-1 py-1">
          <div className="flex w-full items-center gap-2 [&_button]:w-full [&_button]:justify-start">
            {signoutForm}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
