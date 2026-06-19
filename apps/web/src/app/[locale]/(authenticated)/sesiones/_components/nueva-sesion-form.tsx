'use client';

/**
 * F12.2 / F12.6 — Alta de sesión. Dos modos:
 *  · EN BLANCO (12.2): equipo (opcional) + fecha → crea + siembra el esqueleto.
 *  · DESDE PLANTILLA (12.6): elige una plantilla + equipo + fecha → clona la plantilla
 *    a una sesión real (NO siembra el esqueleto: copia los bloques de la plantilla).
 * En ambos, al crear se redirige al editor para ajustar el resto de la cabecera.
 * El modo "desde plantilla" puede venir preseleccionado por ?template=ID (desde la
 * pestaña Plantillas).
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
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { createSession, createSessionFromTemplate } from '../actions';
import type { ClubTeam, TemplateRow } from '../queries';

const NO_TEAM = '__none__';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Mode = 'blank' | 'template';

export function NuevaSesionForm({
  teams,
  templates,
  initialTemplateId,
}: {
  teams: ClubTeam[];
  templates: TemplateRow[];
  initialTemplateId?: string;
}) {
  const t = useTranslations('sesiones');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const hasTemplates = templates.length > 0;
  const validInitial =
    initialTemplateId && templates.some((tpl) => tpl.id === initialTemplateId)
      ? initialTemplateId
      : undefined;

  const [mode, setMode] = useState<Mode>(validInitial ? 'template' : 'blank');
  const [templateId, setTemplateId] = useState<string>(validInitial ?? templates[0]?.id ?? '');
  const [teamId, setTeamId] = useState<string>(NO_TEAM);
  const [date, setDate] = useState<string>(todayIso());

  function submit() {
    startTransition(async () => {
      const res =
        mode === 'template'
          ? await createSessionFromTemplate({
              template_id: templateId,
              team_id: teamId === NO_TEAM ? null : teamId,
              session_date: date || null,
            })
          : await createSession({
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
        {/* Selector de modo (solo si hay plantillas disponibles). */}
        {hasTemplates ? (
          <div className="flex flex-col gap-2">
            <Label>{t('templates.start_from')}</Label>
            <div className="flex gap-2">
              <ModeButton active={mode === 'blank'} onClick={() => setMode('blank')}>
                {t('templates.mode_blank')}
              </ModeButton>
              <ModeButton active={mode === 'template'} onClick={() => setMode('template')}>
                {t('templates.mode_template')}
              </ModeButton>
            </div>
          </div>
        ) : null}

        {mode === 'template' && hasTemplates ? (
          <div className="flex flex-col gap-2">
            <Label>{t('templates.template')}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('templates.template')} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.title ?? t('templates.untitled')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

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
          <Button
            onClick={submit}
            disabled={pending || (mode === 'template' && !templateId)}
          >
            {t('actions.create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary/5 text-foreground'
          : 'border-input text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}
