'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { setTeamFollow } from './follow-actions';
import type { FollowableTeam } from './queries';

type Props = { initialTeams: FollowableTeam[] };

export function FollowListClient({ initialTeams }: Props) {
  const t = useTranslations('directos.follow');
  const [teams, setTeams] = useState<FollowableTeam[]>(initialTeams);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (team: FollowableTeam) => {
    const next = !team.following;
    // Optimista: refleja el cambio y revierte si el server action falla.
    setTeams((prev) =>
      prev.map((x) => (x.teamId === team.teamId ? { ...x, following: next } : x)),
    );
    setPendingId(team.teamId);
    startTransition(async () => {
      const res = await setTeamFollow({ team_id: team.teamId, follow: next });
      if ('error' in res) {
        setTeams((prev) =>
          prev.map((x) =>
            x.teamId === team.teamId ? { ...x, following: !next } : x,
          ),
        );
      }
      setPendingId(null);
    });
  };

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {teams.map((team) => (
        <li key={team.teamId}>
          <Card>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: team.color }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="truncate font-medium">{team.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {team.categoryName}
                  </div>
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                variant={team.following ? 'secondary' : 'default'}
                disabled={pendingId === team.teamId}
                onClick={() => toggle(team)}
                aria-pressed={team.following}
              >
                {team.following ? (
                  <>
                    <Check className="size-4" aria-hidden />
                    <span>{t('following')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="size-4" aria-hidden />
                    <span>{t('follow')}</span>
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
