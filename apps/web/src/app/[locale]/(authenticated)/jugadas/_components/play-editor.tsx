'use client';

/**
 * F13.2a — Editor de jugada: cabecera + <PitchBoard> del FRAME ACTIVO + timeline
 * básica de frames (añadir / borrar / seleccionar activo). Duplicar y reordenar
 * (dnd-kit) llegan en 13.2b.
 *
 * Estado: la jugada vive aquí (Play). Cambiar de frame activo REMONTA el
 * <PitchEditor> con `key` (patrón pizarra) sembrándolo con la escena de ese frame;
 * `onChange` eleva las ediciones al frame activo (y mantiene el `field` común).
 * Guardar valida con `parsePlay` en la server action.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  DIAGRAM_VERSION,
  PLAY_VERSION,
  MAX_FRAMES,
  MIN_FRAME_MS,
  MAX_FRAME_MS,
  DEFAULT_FRAME_MS,
  type Diagram,
  type DiagramField,
  type Play,
  type PlayFrame,
} from '@misterfc/core';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
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
import { PitchEditor } from '@/components/match/pitch-editor';
import type { PlayForEdit, PlayVisibility } from '../queries';
import { updatePlay } from '../actions';

function frameToDiagram(field: DiagramField, frame: PlayFrame): Diagram {
  return { version: DIAGRAM_VERSION, field, elements: frame.elements };
}

export function PlayEditor({ play: initial }: { play: PlayForEdit }) {
  const t = useTranslations('jugadas');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Cabecera editable (el equipo es inmutable → solo se muestra).
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [visibility, setVisibility] = useState<PlayVisibility>(initial.visibility);

  // Jugada (frames + field común).
  const [field, setField] = useState<DiagramField>(initial.play.field);
  const [frames, setFrames] = useState<PlayFrame[]>(initial.play.frames);
  const [active, setActive] = useState(0);

  const activeFrame = frames[active] ?? frames[0]!;

  /** Eleva la escena editada al frame activo (y sincroniza el field común). */
  function onFrameChange(d: Diagram) {
    setField(d.field);
    setFrames((prev) => prev.map((f, i) => (i === active ? { ...f, elements: d.elements } : f)));
  }

  function addFrameAt() {
    if (frames.length >= MAX_FRAMES) {
      toast.error(t('frames.max', { max: MAX_FRAMES }));
      return;
    }
    setFrames((prev) => [...prev, { elements: [] }]);
    setActive(frames.length); // el nuevo (último)
  }

  function removeActive() {
    if (frames.length <= 1) return; // la jugada tiene >= 1 frame
    setFrames((prev) => prev.filter((_, i) => i !== active));
    setActive((a) => (a > 0 ? a - 1 : 0));
  }

  function setActiveDuration(value: string) {
    const n = value.trim() === '' ? undefined : Number.parseInt(value, 10);
    setFrames((prev) =>
      prev.map((f, i) => {
        if (i !== active) return f;
        // Vacío/NaN → sin duration_ms (vuelve al default global DEFAULT_FRAME_MS).
        if (n == null || Number.isNaN(n)) return { elements: f.elements };
        return { ...f, duration_ms: n };
      }),
    );
  }

  function save() {
    const playload: Play = { version: PLAY_VERSION, field, frames };
    startTransition(async () => {
      const res = await updatePlay({
        id: initial.id,
        name: name.trim() === '' ? null : name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        visibility,
        play: playload,
      });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.saved'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Cabecera ───────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-name">{t('fields.name')}</Label>
          <Input
            id="play-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('fields.name_ph')}
            maxLength={120}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('fields.team')}</Label>
          {/* El equipo es inmutable tras crear (trigger 13.1b) → solo lectura. */}
          <Input value={initial.team_name ?? '—'} disabled readOnly />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="play-visibility">{t('fields.visibility')}</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as PlayVisibility)}>
            <SelectTrigger id="play-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">{t('visibility.staff')}</SelectItem>
              <SelectItem value="team">{t('visibility.team')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="play-description">{t('fields.description')}</Label>
          <Textarea
            id="play-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('fields.description_ph')}
            rows={2}
          />
        </div>
      </section>

      {/* ── Timeline de frames ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('frames.title')}</h2>
          <Button type="button" size="sm" variant="outline" onClick={addFrameAt} disabled={pending}>
            <Plus className="size-4" aria-hidden />
            {t('frames.add')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {frames.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                i === active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {t('frames.frame', { n: i + 1 })}
            </button>
          ))}
        </div>

        {/* Controles del frame activo: duración de transición + borrar. */}
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="frame-duration">{t('frames.duration')}</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="frame-duration"
                type="number"
                className="w-28"
                min={MIN_FRAME_MS}
                max={MAX_FRAME_MS}
                step={100}
                value={activeFrame.duration_ms ?? ''}
                placeholder={String(DEFAULT_FRAME_MS)}
                onChange={(e) => setActiveDuration(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">{t('frames.duration_ms')}</span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={removeActive}
            disabled={frames.length <= 1 || pending}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('frames.remove')}
          </Button>
        </div>
      </section>

      {/* ── Board del frame activo ─────────────────────────────────────────── */}
      <section>
        <PitchEditor
          key={active}
          initialDiagram={frameToDiagram(field, activeFrame)}
          onChange={onFrameChange}
          showClear
        />
      </section>

      {/* ── Guardar ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={pending}>
          <Save className="size-4" aria-hidden />
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
