'use client';

import { useTransition } from 'react';
import { Check, ChevronsUpDown, User } from 'lucide-react';
import type { FollowedPlayer } from '@misterfc/core';
import { setActivePlayer } from './actions';
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
  players: FollowedPlayer[];
  activePlayerId: string;
  labels: {
    label: string;
    switch_help: string;
  };
};

/**
 * F14C-4 — Selector de "nieto activo".
 *
 * Si sigue a UN jugador: pinta el nombre como texto (sin selector). Si sigue a
 * VARIOS: dropdown para cambiar. Espejo de ActiveClubSwitcher, pero listando
 * jugadores seguidos (nombre + equipo desde players_sporting).
 */
export function FollowedPlayerSwitcher({
  players,
  activePlayerId,
  labels,
}: Props) {
  const [pending, startTransition] = useTransition();
  const active =
    players.find((p) => p.playerId === activePlayerId) ?? players[0]!;

  if (players.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <User className="size-5 text-zinc-400" aria-hidden />
        <span className="text-xs uppercase tracking-widest text-zinc-400">
          {labels.label}
        </span>
        <span className="font-medium text-white">{active.fullName}</span>
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
          <User className="size-4" aria-hidden />
          <span className="max-w-[16ch] truncate">{active.fullName}</span>
          <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{labels.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {players.map((p) => {
          const isActive = p.playerId === activePlayerId;
          return (
            <DropdownMenuItem
              key={p.playerId}
              disabled={isActive || pending}
              onSelect={(e) => {
                e.preventDefault();
                if (isActive) return;
                startTransition(async () => {
                  await setActivePlayer(p.playerId);
                });
              }}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{p.fullName}</span>
                {p.teamName && (
                  <span className="truncate text-xs text-muted-foreground">
                    {p.teamName}
                  </span>
                )}
              </span>
              {isActive && <Check className="size-4 shrink-0" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
