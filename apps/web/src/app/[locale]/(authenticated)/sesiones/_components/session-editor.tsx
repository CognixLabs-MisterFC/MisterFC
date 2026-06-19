'use client';

/**
 * F12.2 — Editor de sesión: CABECERA editable (persiste) + BLOQUES interactivos
 * (12.2b: picker, overrides, reordenar — en <BlocksEditor>). El total_minutes ya no
 * es manual: lo deriva la suma de los duration_min (mostrado en <BlocksEditor>).
 *
 * Reúsa el `ChipGroup` compartido (extraído de F11) para los objetivos, y los
 * vocabularios/etiquetas de objetivos de `ejercicios.*` (mismo set que F11, D8).
 */

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { TACTICAL_OBJECTIVES, TECHNICAL_OBJECTIVES } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip-group';
import { useRouter } from '@/i18n/navigation';
import { updateSessionHeader } from '../actions';
import { BlocksEditor } from './blocks-editor';
import { PublishControl } from './publish-control';
import type { SessionForEdit, ClubTeam, PickableExercise } from '../queries';

const NO_TEAM = '__none__';

export function SessionEditor({
  session,
  teams,
  pickable,
}: {
  session: SessionForEdit;
  teams: ClubTeam[];
  pickable: PickableExercise[];
}) {
  const t = useTranslations('sesiones');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(session.title ?? '');
  const [date, setDate] = useState(session.session_date ?? '');
  const [teamId, setTeamId] = useState(session.team_id ?? NO_TEAM);
  const [physical, setPhysical] = useState(session.objective_physical ?? '');
  const [tactical, setTactical] = useState<string[]>(session.tactical_objectives);
  const [technical, setTechnical] = useState<string[]>(session.technical_objectives);
  const [meso, setMeso] = useState(session.mesocycle ?? '');
  const [micro, setMicro] = useState(session.microcycle ?? '');

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function save() {
    startTransition(async () => {
      const res = await updateSessionHeader({
        id: session.id,
        title,
        session_date: date || null,
        team_id: teamId === NO_TEAM ? null : teamId,
        objective_physical: physical,
        tactical_objectives: tactical,
        technical_objectives: technical,
        mesocycle: meso,
        microcycle: micro,
      });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.updated'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Cabecera — identidad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('sections.header')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="title">{t('fields.title')}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={t('placeholders.title')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="date">{t('fields.date')}</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
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
        </CardContent>
      </Card>

      {/* Objetivos (reúsa vocabularios de F11 — D8) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('sections.objectives')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChipGroup
            label={t('fields.tactical')}
            options={TACTICAL_OBJECTIVES}
            selected={tactical}
            onToggle={(v) => toggle(tactical, setTactical, v)}
            labelFor={(v) => tTactical(v)}
          />
          <ChipGroup
            label={t('fields.technical')}
            options={TECHNICAL_OBJECTIVES}
            selected={technical}
            onToggle={(v) => toggle(technical, setTechnical, v)}
            labelFor={(v) => tTechnical(v)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="physical">{t('fields.objective_physical')}</Label>
            <Textarea
              id="physical"
              value={physical}
              onChange={(e) => setPhysical(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>
        </CardContent>
      </Card>

      {/* Planificación */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('sections.planning')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="meso">{t('fields.mesocycle')}</Label>
            <Input id="meso" value={meso} onChange={(e) => setMeso(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="micro">{t('fields.microcycle')}</Label>
            <Input id="micro" value={micro} onChange={(e) => setMicro(e.target.value)} maxLength={200} />
          </div>
        </CardContent>
      </Card>

      {/* Guardar cabecera + descargar PDF (12.5, staff) */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="outline" className="gap-2">
          <a href={`/${locale}/sesiones/${session.id}/pdf`}>
            <Download className="size-4" aria-hidden />
            {t('actions.download_pdf')}
          </a>
        </Button>
        <Button onClick={save} disabled={pending}>
          {t('actions.save')}
        </Button>
      </div>

      {/* Publicar al equipo (12.4) — sobre el team_id persistido. */}
      <PublishControl
        sessionId={session.id}
        visibility={session.visibility}
        hasTeam={session.team_id != null}
      />

      {/* Bloques interactivos (picker + overrides + reordenar) */}
      <BlocksEditor session={session} pickable={pickable} />
    </div>
  );
}
