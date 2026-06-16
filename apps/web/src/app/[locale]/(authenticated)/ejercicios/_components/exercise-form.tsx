'use client';

/**
 * F11.6 — Formulario de crear/editar ejercicio (flujo A). Solo `name` es
 * obligatorio; todo lo demás (incluido el diagrama) es opcional. Integra
 * <PitchEditor> como un campo más. El estado objetivo lo decide la ACCIÓN del
 * botón pulsado; el rol/estado actual deciden qué botones se ofrecen. La
 * RLS/trigger de 11.1 son el gate real.
 *
 * Modo: sin `initial` = crear; con `initial` = editar (pre-rellena todos los
 * campos + el diagrama). Editar solo aplica a borrador/propuesto propios (el
 * guard de la page lo asegura). Aprobar/rechazar NO está aquí (es 11.7).
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
  type MethodologyStatus,
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
import { createExercise, updateExercise } from '../actions';

/** Valores iniciales al EDITAR (campos del form + id + estado actual). */
export type ExerciseFormInitial = {
  id: string;
  status: MethodologyStatus;
  name: string;
  categories: string[];
  tactical_objectives: string[];
  technical_objectives: string[];
  physical_focus: string | null;
  intensity: string | null;
  space_type: string | null;
  space_dimensions: string | null;
  base_duration: number | null;
  objective: string | null;
  description: string | null;
  coaching_points: string | null;
  variants: string | null;
  players: string | null;
  diagram: Diagram | null;
};

type ActionButton = { action: ExerciseFormAction; label: string; primary: boolean };

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

export function ExerciseForm({
  isAdmin,
  initial,
}: {
  isAdmin: boolean;
  initial?: ExerciseFormInitial;
}) {
  const t = useTranslations('ejercicios');
  const tForm = useTranslations('ejercicios.form');
  const tTactical = useTranslations('ejercicios.tactical');
  const tTechnical = useTranslations('ejercicios.technical');
  const tCategory = useTranslations('category_kinds');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initial?.name ?? '');
  const [categories, setCategories] = useState<string[]>(initial?.categories ?? []);
  const [tactical, setTactical] = useState<string[]>(initial?.tactical_objectives ?? []);
  const [technical, setTechnical] = useState<string[]>(initial?.technical_objectives ?? []);
  const [physicalFocus, setPhysicalFocus] = useState(initial?.physical_focus ?? '');
  const [intensity, setIntensity] = useState<string>(initial?.intensity ?? NONE);
  const [spaceType, setSpaceType] = useState<string>(initial?.space_type ?? NONE);
  const [spaceDimensions, setSpaceDimensions] = useState(initial?.space_dimensions ?? '');
  const [baseDuration, setBaseDuration] = useState(
    initial?.base_duration != null ? String(initial.base_duration) : ''
  );
  const [objective, setObjective] = useState(initial?.objective ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [coachingPoints, setCoachingPoints] = useState(initial?.coaching_points ?? '');
  const [variants, setVariants] = useState(initial?.variants ?? '');
  const [players, setPlayers] = useState(initial?.players ?? '');
  const [diagram, setDiagram] = useState<Diagram | null>(initial?.diagram ?? null);

  const nameMissing = name.trim().length === 0;

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  // Botones según modo (crear/editar), estado actual y rol. Aprobar/rechazar de
  // un propuesto NO está aquí (11.7): editar un propuesto solo "Guarda cambios".
  function actionButtons(): ActionButton[] {
    if (!initial) {
      const draft: ActionButton = {
        action: 'save_draft',
        label: tForm('actions.save_draft'),
        primary: false,
      };
      return isAdmin
        ? [draft, { action: 'publish', label: tForm('actions.publish'), primary: true }]
        : [draft, { action: 'propose', label: tForm('actions.propose'), primary: true }];
    }
    if (initial.status === 'proposed') {
      return [{ action: 'propose', label: tForm('actions.save_changes'), primary: true }];
    }
    // Editando un borrador.
    const btns: ActionButton[] = [
      { action: 'save_draft', label: tForm('actions.save_draft'), primary: false },
      { action: 'propose', label: tForm('actions.propose'), primary: !isAdmin },
    ];
    if (isAdmin) btns.push({ action: 'publish', label: tForm('actions.publish'), primary: true });
    return btns;
  }

  function submit(action: ExerciseFormAction) {
    if (nameMissing) {
      toast.error(tForm('errors.name_required'));
      return;
    }
    startTransition(async () => {
      const payload = {
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
      };
      const res = initial
        ? await updateExercise({ ...payload, id: initial.id })
        : await createExercise(payload);

      if (res.error) {
        toast.error(tForm(`errors.${res.error}`));
        return;
      }
      toast.success(initial ? tForm('toast.updated') : tForm('toast.created'));
      router.push(`/ejercicios/${res.id ?? initial?.id}`);
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
          <PitchEditor initialDiagram={initial?.diagram ?? undefined} onChange={setDiagram} />
        </CardContent>
      </Card>

      {/* Acciones según modo/estado/rol (ver actionButtons). */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background/80 py-3 backdrop-blur">
        {actionButtons().map((b) => (
          <Button
            key={b.action}
            variant={b.primary ? 'default' : 'outline'}
            onClick={() => submit(b.action)}
            disabled={pending || nameMissing}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
