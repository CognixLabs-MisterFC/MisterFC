'use client';

/**
 * F12.2 — Alta mínima de sesión: equipo destino (opcional) + fecha (por defecto
 * hoy). Al crear, la server action siembra el esqueleto y devuelve el id; aquí se
 * redirige al editor, donde se rellena el resto de la cabecera.
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
import { createSession } from '../actions';
import type { ClubTeam } from '../queries';

const NO_TEAM = '__none__';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NuevaSesionForm({ teams }: { teams: ClubTeam[] }) {
  const t = useTranslations('sesiones');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teamId, setTeamId] = useState<string>(NO_TEAM);
  const [date, setDate] = useState<string>(todayIso());

  function submit() {
    startTransition(async () => {
      const res = await createSession({
        team_id: teamId === NO_TEAM ? null : teamId,
        session_date: date || null,
      });
      if (res.error || !res.id) {
        toast.error(t(`errors.${res.error ?? 'generic'}`));
        return;
      }
      toast.success(t('toast.created'));
      router.push(`/sesiones/${res.id}/editar`);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-col gap-2">
          <Label>{t('fields.team')}</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder={t('fields.team_none')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEAM}>{t('fields.team_none')}</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name} · {team.season}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="session_date">{t('fields.date')}</Label>
          <Input
            id="session_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending}>
            {t('actions.create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
