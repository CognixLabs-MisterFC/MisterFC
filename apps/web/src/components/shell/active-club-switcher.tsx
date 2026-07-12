'use client';

import { useTransition } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { CurrentUserClub } from '@misterfc/core';
import { setActiveClub } from './actions';
import { ClubLogo } from '@/components/ui/club-logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type Props = {
  clubs: CurrentUserClub[];
  activeClubId: string;
  labels: {
    label: string;
    switch_help: string;
  };
};

/**
 * Si el user pertenece a un único club: pinta el nombre como texto.
 * Si pertenece a varios: dropdown para cambiar.
 */
export function ActiveClubSwitcher({ clubs, activeClubId, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const active = clubs.find((c) => c.club.id === activeClubId) ?? clubs[0]!;

  if (clubs.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <ClubLogo
          path={active.club.logo_path}
          name={active.club.name}
          className="size-6"
        />
        <span className="text-xs uppercase tracking-widest text-zinc-400">
          {labels.label}
        </span>
        <span className="font-medium text-white">{active.club.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'gap-2 border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800',
            pending && 'opacity-60'
          )}
          aria-label={labels.switch_help}
        >
          <ClubLogo
            path={active.club.logo_path}
            name={active.club.name}
            className="size-5"
          />
          <span className="max-w-[14ch] truncate">{active.club.name}</span>
          <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{labels.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clubs.map((c) => {
          const isActive = c.club.id === activeClubId;
          return (
            <DropdownMenuItem
              key={c.club.id}
              disabled={isActive || pending}
              onSelect={(e) => {
                e.preventDefault();
                if (isActive) return;
                startTransition(async () => {
                  await setActiveClub(c.club.id);
                });
              }}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2 truncate">
                <ClubLogo
                  path={c.club.logo_path}
                  name={c.club.name}
                  className="size-5"
                />
                <span className="truncate">{c.club.name}</span>
              </span>
              {isActive && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
