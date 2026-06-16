'use client';

/**
 * F11.6 — Formulario de crear ejercicio (flujo A). Solo `name` es obligatorio;
 * todo lo demás (incluido el diagrama) es opcional. Integra <PitchEditor> como un
 * campo más. El estado objetivo lo decide la ACCIÓN del botón pulsado; el rol solo
 * cambia qué botones se ofrecen (entrenador: borrador/proponer; Admin: publicar).
 * La RLS/trigger de 11.1 son el gate real.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CATEGORY_KINDS,
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  type ExerciseFormAction,
  type Diagram,
} from '@misterfc/core';
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
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { PitchEditor } from '@/components/match/pitch-editor';
import { createExercise } from '../actions';

// Sentinela para "sin valor" en los Select de un solo valor (Radix no admite '').
const NONE = '__none__';

type ChipGroupProps = {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor: (value: string) => string;
};

function ChipGroup({ label, options, selected, onToggle, labelFor }: ChipGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(opt)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:border-foreground/40'
              )}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExerciseForm({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('ejercicios');
  const tForm = useTranslations('ejercicios.form');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');
  const tCategory = useTranslations('category_kinds');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [tactical, setTactical] = useState<string[]>([]);
  const [technical, setTechnical] = useState<string[]>([]);
  const [physicalFocus, setPhysicalFocus] = useState('');
  const [intensity, setIntensity] = useState<string>(NONE);
  const [spaceType, setSpaceType] = useState<string>(NONE);
  const [spaceDimensions, setSpaceDimensions] = useState('');
  const [baseDuration, setBaseDuration] = useState('');
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');
  const [coachingPoints, setCoachingPoints] = useState('');
  const [variants, setVariants] = useState('');
  const [players, setPlayers] = useState('');
  const [diagram, setDiagram] = useState<Diagram | null>(null);

  const nameMissing = name.trim().length === 0;

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function submit(action: ExerciseFormAction) {
    if (nameMissing) {
      toast.error(tForm('errors.name_required'));
      return;
    }
    startTransition(async () => {
      const res = await createExercise({
        action,
        name,
        categories,
        tactical_objectives: tactical,
        technical_objectives: technical,
        physical_focus: physicalFocus,
        intensity: intensity === NONE ? null : intensity,
        space_type: spaceType === NONE ? null : spaceType,
        space_dimensions: spaceDimensions,
        base_duration: baseDuration,
        objective,
        description,
        coaching_points: coachingPoints,
        variants,
        players,
        diagram,
      });

      if (res.error) {
        toast.error(tForm(`errors.${res.error}`));
        return;
      }
      toast.success(tForm('toast.created'));
      router.push(`/ejercicios/${res.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Identidad */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">
              {tForm('fields.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={tForm('placeholders.name')}
              aria-invalid={nameMissing}
            />
          </div>

          <ChipGroup
            label={tForm('fields.categories')}
            options={CATEGORY_KINDS}
            selected={categories}
            onToggle={(v) => toggle(categories, setCategories, v)}
            labelFor={(v) => tCategory(v)}
          />
        </CardContent>
      </Card>

      {/* Objetivos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tForm('sections.objectives')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChipGroup
            label={tForm('fields.tactical')}
            options={TACTICAL_OBJECTIVES}
            selected={tactical}
            onToggle={(v) => toggle(tactical, setTactical, v)}
            labelFor={(v) => tTactical(v)}
          />
          <ChipGroup
            label={tForm('fields.technical')}
            options={TECHNICAL_OBJECTIVES}
            selected={technical}
            onToggle={(v) => toggle(technical, setTechnical, v)}
            labelFor={(v) => tTechnical(v)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="physical_focus">{tForm('fields.physical_focus')}</Label>
            <Input
              id="physical_focus"
              value={physicalFocus}
              onChange={(e) => setPhysicalFocus(e.target.value)}
              maxLength={2000}
            />
          </div>
        </CardContent>
      </Card>

      {/* Parámetros */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tForm('sections.params')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>{tForm('fields.intensity')}</Label>
            <Select value={intensity} onValueChange={setIntensity}>
              <SelectTrigger>
                <SelectValue placeholder={tForm('placeholders.none')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tForm('placeholders.none')}</SelectItem>
                {EXERCISE_INTENSITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`intensity_values.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tForm('fields.space_type')}</Label>
            <Select value={spaceType} onValueChange={setSpaceType}>
              <SelectTrigger>
                <SelectValue placeholder={tForm('placeholders.none')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tForm('placeholders.none')}</SelectItem>
                {EXERCISE_SPACE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`space_types.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="space_dimensions">{tForm('fields.space_dimensions')}</Label>
            <Input
              id="space_dimensions"
              value={spaceDimensions}
              onChange={(e) => setSpaceDimensions(e.target.value)}
              maxLength={60}
              placeholder={tForm('placeholders.space_dimensions')}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="base_duration">{tForm('fields.base_duration')}</Label>
            <Input
              id="base_duration"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              value={baseDuration}
              onChange={(e) => setBaseDuration(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Desarrollo (textos) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tForm('sections.development')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(
            [
              ['objective', objective, setObjective],
              ['description', description, setDescription],
              ['coaching_points', coachingPoints, setCoachingPoints],
              ['variants', variants, setVariants],
              ['players', players, setPlayers],
            ] as const
          ).map(([key, value, setter]) => (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={key}>{tForm(`fields.${key}`)}</Label>
              <Textarea
                id={key}
                value={value}
                onChange={(e) => setter(e.target.value)}
                rows={3}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Diagrama (opcional) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tForm('sections.diagram')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PitchEditor onChange={setDiagram} />
        </CardContent>
      </Card>

      {/* Acciones (según rol) */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background/80 py-3 backdrop-blur">
        {isAdmin ? (
          <Button onClick={() => submit('publish')} disabled={pending || nameMissing}>
            {tForm('actions.publish')}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => submit('save_draft')}
              disabled={pending || nameMissing}
            >
              {tForm('actions.save_draft')}
            </Button>
            <Button onClick={() => submit('propose')} disabled={pending || nameMissing}>
              {tForm('actions.propose')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
