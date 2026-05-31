'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  BENCH_ZONE_ID,
  OUT_ZONE_ID,
  OUT_REASONS,
  applyDrop,
  defaultFormation,
  formationsForFormat,
  getFormation,
  playerDraggableId,
  remapToFormation,
  resolveDrop,
  roleFromPosition,
  type OutReason,
  type PlayerPositionMain,
  type PositionAssignment,
  type TeamFormat,
} from '@misterfc/core';
import { Loader2, Plus, UserMinus } from 'lucide-react';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  createLineup,
  deleteLineupPosition,
  setLineupFormation,
  setLineupOfficial,
  upsertLineupPosition,
} from '../actions';

export type RosterPlayerVM = {
  playerId: string;
  firstName: string;
  lastName: string;
  dorsal: number | null;
  positionMain: PlayerPositionMain;
};

export type LineupSummaryVM = {
  id: string;
  name: string;
  formationCode: string;
  isOfficial: boolean;
};

type Props = {
  eventId: string;
  format: TeamFormat;
  roster: RosterPlayerVM[];
  lineups: LineupSummaryVM[];
  selectedLineupId: string | null;
  selectedFormationCode: string | null;
  selectedIsOfficial: boolean;
  initialPositions: PositionAssignment[];
};

function shortLabel(p: RosterPlayerVM | undefined, playerId: string): string {
  if (!p) return playerId.slice(0, 4);
  return p.lastName || p.firstName || playerId.slice(0, 4);
}

/** Une las posiciones de BD con el roster: los sin posición arrancan en banquillo. */
function mergeInitial(
  positions: PositionAssignment[],
  roster: RosterPlayerVM[],
): PositionAssignment[] {
  const present = new Set(positions.map((p) => p.playerId));
  const extra: PositionAssignment[] = roster
    .filter((r) => !present.has(r.playerId))
    .map((r) => ({
      playerId: r.playerId,
      location: 'bench',
      positionCode: null,
      xPct: null,
      yPct: null,
      outReason: null,
    }));
  return [...positions, ...extra];
}

function DropZone({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-24 flex-col gap-1.5 rounded-md border border-dashed border-border p-2 transition-colors',
        isOver && 'border-emerald-500 bg-emerald-500/10',
        className,
      )}
    >
      {children}
    </div>
  );
}

function PlayerPill({
  playerId,
  label,
  dorsal,
}: {
  playerId: string;
  label: string;
  dorsal: number | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: playerDraggableId(playerId),
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={cn(
        'flex w-full cursor-grab touch-none items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
      {...listeners}
      {...attributes}
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {dorsal ?? '·'}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function LineupEditorClient(props: Props) {
  const {
    eventId,
    format,
    roster,
    lineups,
    selectedLineupId,
    selectedFormationCode,
    selectedIsOfficial,
    initialPositions,
  } = props;

  const t = useTranslations('alineacion');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rosterById = useMemo(
    () => new Map(roster.map((r) => [r.playerId, r])),
    [roster],
  );

  const [positions, setPositions] = useState<PositionAssignment[]>(() =>
    mergeInitial(initialPositions, roster),
  );
  const [formationCode, setFormationCode] = useState<string>(
    selectedFormationCode ?? defaultFormation(format).code,
  );

  // ── Create state (cuando no hay alineación) ──────────────────────────────
  const [newName, setNewName] = useState('Titular');
  const [newFormation, setNewFormation] = useState<string>(
    defaultFormation(format).code,
  );

  const formations = useMemo(() => formationsForFormat(format), [format]);

  // Sensores dnd-kit: se declaran antes de cualquier return condicional para
  // respetar las reglas de hooks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (selectedLineupId == null) {
    return (
      <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">{t('empty_hint')}</p>
        <label className="text-xs font-medium">{t('name_label')}</label>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={60}
        />
        <label className="text-xs font-medium">{t('formation_label')}</label>
        <Select value={newFormation} onValueChange={setNewFormation}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formations.map((f) => (
              <SelectItem key={f.code} value={f.code}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={pending || newName.trim().length === 0}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await createLineup({
                event_id: eventId,
                name: newName.trim(),
                formation_code: newFormation,
              });
              if (r.error) {
                setError(r.error);
                return;
              }
              if (r.lineupId) router.push(`${pathname}?lineup=${r.lineupId}`);
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('create')}
        </Button>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {t(`errors.${error}` as 'errors.generic')}
          </p>
        )}
      </div>
    );
  }

  const lineupId = selectedLineupId;
  const formation = getFormation(formationCode);

  const fieldPlayers: FieldEditorPlayer[] = positions
    .filter((p) => p.location === 'field')
    .map((p) => ({
      playerId: p.playerId,
      label: shortLabel(rosterById.get(p.playerId), p.playerId),
      dorsal: rosterById.get(p.playerId)?.dorsal ?? null,
      positionCode: p.positionCode,
      xPct: p.xPct,
      yPct: p.yPct,
    }));
  const benchPlayers = positions.filter((p) => p.location === 'bench');
  const outPlayers = positions.filter((p) => p.location === 'out');

  function persist(
    next: PositionAssignment[],
    changed: string[],
    prev: PositionAssignment[],
  ) {
    startTransition(async () => {
      setError(null);
      for (const pid of changed) {
        const a = next.find((x) => x.playerId === pid);
        if (!a) continue;
        const r = await upsertLineupPosition({
          lineup_id: lineupId,
          player_id: pid,
          location: a.location,
          position_code: a.positionCode,
          x_pct: a.xPct,
          y_pct: a.yPct,
          out_reason: a.outReason,
        });
        if (r.error) {
          setPositions(prev);
          setError(r.error);
          return;
        }
      }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const drop = resolveDrop(
      String(e.active.id),
      e.over ? String(e.over.id) : null,
    );
    if (!drop) return;
    const prev = positions;
    const { next, changed } = applyDrop(prev, drop, formation);
    if (changed.length === 0) return;
    setPositions(next);
    persist(next, changed, prev);
  }

  function changeOutReason(playerId: string, reason: OutReason) {
    const prev = positions;
    const next = positions.map((p) =>
      p.playerId === playerId ? { ...p, outReason: reason } : p,
    );
    setPositions(next);
    persist(next, [playerId], prev);
  }

  function removeFromLineup(playerId: string) {
    const prev = positions;
    const next = positions.filter((p) => p.playerId !== playerId);
    setPositions(next);
    startTransition(async () => {
      const r = await deleteLineupPosition({ lineup_id: lineupId, player_id: playerId });
      if (r.error) {
        setPositions(prev);
        setError(r.error);
      }
    });
  }

  function onFormationChange(code: string) {
    const next = getFormation(code) ?? defaultFormation(format);
    const fp = positions
      .filter((p) => p.location === 'field')
      .map((p) => ({
        playerId: p.playerId,
        role: roleFromPosition(rosterById.get(p.playerId)?.positionMain),
      }));
    const { assignments, benched } = remapToFormation(fp, next);
    const assignMap = new Map(assignments.map((a) => [a.playerId, a]));
    const benchedSet = new Set(benched);
    const optimistic = positions.map((p) => {
      if (assignMap.has(p.playerId)) {
        const a = assignMap.get(p.playerId)!;
        return { ...p, location: 'field' as const, positionCode: a.positionCode, xPct: a.xPct, yPct: a.yPct, outReason: null };
      }
      if (benchedSet.has(p.playerId)) {
        return { ...p, location: 'bench' as const, positionCode: null, xPct: null, yPct: null, outReason: null };
      }
      return p;
    });
    const prev = positions;
    setPositions(optimistic);
    setFormationCode(code);
    startTransition(async () => {
      const r = await setLineupFormation({ lineup_id: lineupId, formation_code: code });
      if (r.error) {
        setPositions(prev);
        setFormationCode(formationCode);
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function onToggleOfficial(value: boolean) {
    startTransition(async () => {
      const r = await setLineupOfficial({ lineup_id: lineupId, is_official: value });
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controles superiores */}
      <div className="flex flex-wrap items-center gap-3">
        {lineups.length > 1 && (
          <Select
            value={lineupId}
            onValueChange={(id) => router.push(`${pathname}?lineup=${id}`)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lineups.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.isOfficial ? ` · ${t('official_badge')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('formation_label')}</span>
          <Select value={formationCode} onValueChange={onFormationChange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formations.map((f) => (
                <SelectItem key={f.code} value={f.code}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={selectedIsOfficial}
            onCheckedChange={onToggleOfficial}
            disabled={pending}
          />
          {t('official_label')}
        </label>

        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await createLineup({
                event_id: eventId,
                name: t('new_lineup_default_name'),
                formation_code: defaultFormation(format).code,
              });
              if (r.error) {
                setError(r.error);
                return;
              }
              if (r.lineupId) router.push(`${pathname}?lineup=${r.lineupId}`);
              router.refresh();
            })
          }
        >
          <Plus className="size-4" aria-hidden />
          {t('new_lineup')}
        </Button>

        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          {pending ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t('saving')}
            </>
          ) : (
            t('saved')
          )}
        </span>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_1fr]">
          {/* Banquillo */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t('bench')} · {benchPlayers.length}
            </h3>
            <DropZone id={BENCH_ZONE_ID}>
              {benchPlayers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('bench_empty')}</p>
              ) : (
                benchPlayers.map((p) => (
                  <PlayerPill
                    key={p.playerId}
                    playerId={p.playerId}
                    label={shortLabel(rosterById.get(p.playerId), p.playerId)}
                    dorsal={rosterById.get(p.playerId)?.dorsal ?? null}
                  />
                ))
              )}
            </DropZone>
          </section>

          {/* Campo */}
          <section>
            <MatchFieldEditor
              format={format}
              formationCode={formationCode}
              players={fieldPlayers}
              mode="edit"
            />
          </section>

          {/* Fuera de convocatoria */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t('out')} · {outPlayers.length}
            </h3>
            <DropZone id={OUT_ZONE_ID}>
              {outPlayers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('out_empty')}</p>
              ) : (
                outPlayers.map((p) => (
                  <div key={p.playerId} className="flex flex-col gap-1">
                    <PlayerPill
                      playerId={p.playerId}
                      label={shortLabel(rosterById.get(p.playerId), p.playerId)}
                      dorsal={rosterById.get(p.playerId)?.dorsal ?? null}
                    />
                    <div className="flex items-center gap-1 pl-1">
                      <Select
                        value={p.outReason ?? 'tecnico'}
                        onValueChange={(v) => changeOutReason(p.playerId, v as OutReason)}
                      >
                        <SelectTrigger className="h-7 flex-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OUT_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`out_reason.${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('remove')}
                        onClick={() => removeFromLineup(p.playerId)}
                      >
                        <UserMinus className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </DropZone>
          </section>
        </div>
      </DndContext>
    </div>
  );
}
