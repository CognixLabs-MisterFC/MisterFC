'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { TEAM_FORMATS } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createTeam, updateTeam, type TeamFormState } from './actions';

type Mode = 'create' | 'edit';

export type Division = {
  value: string;
  regimeType: 'rolling' | 'limited';
  maxSubs: number | null;
};

type CategoryOpt = { id: string; name: string; kind: string | null };

type Props = {
  mode: Mode;
  /** Catálogo de divisiones por kind (substitution_regimes). */
  divisionsByKind: Record<string, Division[]>;
  /** create: temporada por defecto (la seleccionada en el listado). */
  defaultSeason?: string;
  /** create: categorías-plantilla del club para el selector. */
  categories?: CategoryOpt[];
  /** edit: datos del equipo (la temporada y la categoría no se cambian aquí). */
  team?: {
    id: string;
    name: string;
    format: (typeof TEAM_FORMATS)[number];
    color: string;
    division: string | null;
    categoryKind: string | null;
  };
};

const DEFAULT_COLOR = '#10B981';
const NO_DIVISION = '__none__';

export function TeamDialog({
  mode,
  divisionsByKind,
  defaultSeason,
  categories = [],
  team,
}: Props) {
  const t = useTranslations('equipos');
  const [open, setOpen] = useState(false);
  const isEdit = mode === 'edit';

  // create: categoría seleccionada → su kind → divisiones disponibles.
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const selectedKind = isEdit
    ? (team?.categoryKind ?? null)
    : (categories.find((c) => c.id === categoryId)?.kind ?? null);
  const divisions = selectedKind ? (divisionsByKind[selectedKind] ?? []) : [];

  const [division, setDivision] = useState(
    team?.division ?? divisions[0]?.value ?? NO_DIVISION,
  );

  // Al cambiar de categoría en alta, reencuadra la división a la 1ª válida.
  function onCategoryChange(id: string) {
    setCategoryId(id);
    const kind = categories.find((c) => c.id === id)?.kind ?? null;
    const next = kind ? (divisionsByKind[kind] ?? []) : [];
    setDivision(next[0]?.value ?? NO_DIVISION);
  }

  const divisionLabel = (d: Division) => {
    const name = t(`divisions.${d.value}`);
    const tag =
      d.regimeType === 'rolling'
        ? t('division_regime.rolling')
        : t('division_regime.limited', { max: d.maxSubs ?? 0 });
    return `${name} · ${tag}`;
  };

  const action =
    isEdit && team ? updateTeam.bind(null, team.id) : createTeam;

  const [state, formAction, pending] = useActionState<TeamFormState, FormData>(
    action,
    {},
  );

  // Cierra el dialog al guardar OK (render-time guard, ver patrón en el resto).
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;
  const noCategories = !isEdit && categories.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label={t('actions.edit')}>
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button disabled={noCategories}>
            <Plus className="size-4" aria-hidden />
            <span>{t('actions.create')}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('dialog.edit_title') : t('dialog.create_title')}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {!isEdit && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="team-season">{t('field.season')}</Label>
                <Input
                  id="team-season"
                  name="season"
                  required
                  placeholder="2025-26"
                  pattern="[0-9]{4}-[0-9]{2}"
                  defaultValue={defaultSeason ?? ''}
                />
                <p className="text-xs text-muted-foreground">
                  {t('field.season_help')}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="team-category">{t('field.category')}</Label>
                <input type="hidden" name="category_id" value={categoryId} />
                <Select value={categoryId} onValueChange={onCategoryChange}>
                  <SelectTrigger id="team-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('field.name')}</Label>
            <Input
              id="team-name"
              name="name"
              required
              maxLength={80}
              defaultValue={team?.name ?? ''}
              autoFocus={isEdit}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="team-format">{t('field.format')}</Label>
            <Select name="format" defaultValue={team?.format ?? 'F7'}>
              <SelectTrigger id="team-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {divisions.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="team-division">{t('field.division')}</Label>
              <input type="hidden" name="division" value={division} />
              <Select value={division} onValueChange={setDivision}>
                <SelectTrigger id="team-division">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {divisions.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {divisionLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('field.division_help')}
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="team-color">{t('field.color')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="team-color"
                name="color"
                type="color"
                className="h-10 w-16 p-1"
                defaultValue={team?.color ?? DEFAULT_COLOR}
              />
              <p className="text-xs text-muted-foreground">
                {t('field.color_help')}
              </p>
            </div>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('actions.save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
