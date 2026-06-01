'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  blankFormationPositions,
  clampPct,
  type CoachFormation,
  type CoachFormationPosition,
  type TeamFormat,
} from '@misterfc/core';
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
import { useRouter } from '@/i18n/navigation';
import { createFormation, updateFormation } from '../actions';

const FORMATS: TeamFormat[] = ['F7', 'F8', 'F11'];

// Códigos sugeridos para acceso rápido (el campo es libre, max 20 chars).
const QUICK_CODES = ['POR', 'LD', 'DFC', 'LI', 'MCD', 'MC', 'MD', 'MI', 'MP', 'ED', 'DC', 'EI'];

type Props = {
  initial?: CoachFormation;
  onClose: () => void;
};

function Pitch() {
  return (
    <svg
      viewBox="0 0 100 150"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
      aria-hidden
    >
      <rect x="0" y="0" width="100" height="150" fill="#15803d" />
      <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6">
        <rect x="3" y="3" width="94" height="144" />
        <line x1="3" y1="75" x2="97" y2="75" />
        <circle cx="50" cy="75" r="11" />
        <rect x="22" y="123" width="56" height="24" />
        <rect x="22" y="3" width="56" height="24" />
      </g>
    </svg>
  );
}

function PositionChip({
  index,
  pos,
  selected,
  onSelect,
}: {
  index: number;
  pos: CoachFormationPosition;
  selected: boolean;
  onSelect: (i: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `pos:${index}` });

  const style: React.CSSProperties = {
    left: `${pos.x_pct}%`,
    top: `${pos.y_pct}%`,
    transform: transform
      ? `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px))`
      : 'translate(-50%, -50%)',
    zIndex: isDragging ? 30 : selected ? 20 : 10,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`absolute flex size-9 touch-none items-center justify-center rounded-full border-2 text-[10px] font-semibold shadow ${
        selected
          ? 'border-amber-300 bg-amber-100 text-amber-900'
          : 'border-white bg-white/90 text-slate-800'
      }`}
      style={style}
      onClick={() => onSelect(index)}
      {...listeners}
      {...attributes}
    >
      {pos.position_code || '·'}
    </button>
  );
}

export function FormationBuilder({ initial, onClose }: Props) {
  const t = useTranslations('formaciones');
  const router = useRouter();
  const pitchRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [format, setFormat] = useState<TeamFormat>(initial?.format ?? 'F8');
  const [positions, setPositions] = useState<CoachFormationPosition[]>(
    initial?.positions ?? blankFormationPositions(initial?.format ?? 'F8'),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function changeFormat(next: TeamFormat) {
    setFormat(next);
    // Al cambiar de modalidad cambia el nº de posiciones: resembramos el preset.
    setPositions(blankFormationPositions(next));
    setSelected(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    if (!id.startsWith('pos:')) return;
    const idx = Number(id.slice(4));
    const rect = pitchRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const dxPct = (e.delta.x / rect.width) * 100;
    const dyPct = (e.delta.y / rect.height) * 100;
    setPositions((prev) =>
      prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              x_pct: clampPct(p.x_pct + dxPct),
              y_pct: clampPct(p.y_pct + dyPct),
            }
          : p,
      ),
    );
  }

  function setSelectedCode(code: string) {
    if (selected === null) return;
    setPositions((prev) =>
      prev.map((p, i) =>
        i === selected ? { ...p, position_code: code.slice(0, 20) } : p,
      ),
    );
  }

  async function handleSave() {
    if (saving) return;
    if (name.trim().length === 0) {
      toast.error(t('errors.name_required'));
      return;
    }
    setSaving(true);
    const payload = { name: name.trim(), format, positions };
    const res = initial
      ? await updateFormation({ id: initial.id, ...payload })
      : await createFormation(payload);
    setSaving(false);

    if (res.error) {
      toast.error(t(`errors.${res.error}`));
      return;
    }
    toast.success(initial ? t('toast.updated') : t('toast.created'));
    router.refresh();
    onClose();
  }

  const selectedPos = selected !== null ? positions[selected] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="formation-name">{t('field.name')}</Label>
          <Input
            id="formation-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('field.name_placeholder')}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t('field.format')}</Label>
          <Select value={format} onValueChange={(v) => changeFormat(v as TeamFormat)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('builder_hint')}</p>

      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        onDragStart={(e) => setSelected(Number(String(e.active.id).slice(4)))}
      >
        <div
          ref={pitchRef}
          className="relative mx-auto aspect-[2/3] w-full max-w-sm overflow-hidden rounded-lg"
        >
          <Pitch />
          {positions.map((pos, i) => (
            <PositionChip
              key={i}
              index={i}
              pos={pos}
              selected={selected === i}
              onSelect={setSelected}
            />
          ))}
        </div>
      </DndContext>

      {selectedPos ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label htmlFor="position-code">{t('field.position_code')}</Label>
          <Input
            id="position-code"
            value={selectedPos.position_code}
            maxLength={20}
            onChange={(e) => setSelectedCode(e.target.value)}
            className="w-32"
          />
          <div className="flex flex-wrap gap-1">
            {QUICK_CODES.map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedCode(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('select_chip_hint')}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </div>
  );
}
