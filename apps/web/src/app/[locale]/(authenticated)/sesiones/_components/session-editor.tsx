'use client';

/**
 * F12.2a — Editor de sesión: CABECERA editable (persiste) + BLOQUES sembrados
 * mostrados con sus tareas (read-structure). El picker de ejercicios, los overrides
 * editables, la suma automática de total_minutes y el reordenar (dnd-kit) llegan en
 * 12.2b — por eso los bloques se ven vacíos: es lo esperado.
 *
 * Reúsa el `ChipGroup` compartido (extraído de F11) para los objetivos, y los
 * vocabularios/etiquetas de objetivos de `ejercicios.*` (mismo set que F11, D8).
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { ChipGroup } from '@/components/ui/chip-group';
import { useRouter } from '@/i18n/navigation';
import { updateSessionHeader } from '../actions';
import type { SessionForEdit, ClubTeam } from '../queries';

const NO_TEAM = '__none__';

export function SessionEditor({
  session,
  teams,
}: {
  session: SessionForEdit;
  teams: ClubTeam[];
}) {
  const t = useTranslations('sesiones');
  const tBlocks = useTranslations('sesiones.block_types');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');
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
  const [totalMinutes, setTotalMinutes] = useState(
    session.total_minutes != null ? String(session.total_minutes) : ''
  );

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
        total_minutes: totalMinutes,
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
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="meso">{t('fields.mesocycle')}</Label>
            <Input id="meso" value={meso} onChange={(e) => setMeso(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="micro">{t('fields.microcycle')}</Label>
            <Input id="micro" value={micro} onChange={(e) => setMicro(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="total_minutes">{t('fields.total_minutes')}</Label>
            <Input
              id="total_minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              value={totalMinutes}
              onChange={(e) => setTotalMinutes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bloques sembrados (read-structure en 12.2a) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('sections.blocks')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {session.blocks.map((block) => (
            <div key={block.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{tBlocks(block.block_type)}</Badge>
                {block.title ? (
                  <span className="text-sm font-medium">{block.title}</span>
                ) : null}
              </div>
              {block.tasks.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t('blocks.empty')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {block.tasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between text-sm">
                      <span>{task.exercise_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {task.series ?? (task.duration_min != null ? `${task.duration_min}'` : '')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Guardar cabecera */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background/80 py-3 backdrop-blur">
        <Button onClick={save} disabled={pending}>
          {t('actions.save')}
        </Button>
      </div>
    </div>
  );
}
