'use client';

/**
 * F13.2a — Alta de jugada: equipo (obligatorio, D1 team-scoped) + nombre → crea la
 * jugada (siembra 1 frame vacío en el server) y redirige al editor. El equipo se
 * fija aquí porque es INMUTABLE tras crear (trigger 13.1b).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import { createPlay } from '../actions';
import type { ClubTeam } from '../queries';

export function NuevaJugadaForm({ teams }: { teams: ClubTeam[] }) {
  const t = useTranslations('jugadas');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? '');
  const [name, setName] = useState('');

  const canSubmit = teamId !== '' && name.trim() !== '';

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createPlay({ team_id: teamId, name: name.trim() });
      if (res.error || !res.id) {
        toast.error(t(`errors.${res.error ?? 'generic'}`));
        return;
      }
      router.push(`/jugadas/${res.id}/editar`);
    });
  }

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">{t('no_teams')}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-play-team">{t('fields.team')}</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger id="new-play-team">
              <SelectValue placeholder={t('fields.team_ph')} />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name} · {team.season}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-play-name">{t('fields.name')}</Label>
          <Input
            id="new-play-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('fields.name_ph')}
            maxLength={120}
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={!canSubmit || pending}>
            {t('create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
