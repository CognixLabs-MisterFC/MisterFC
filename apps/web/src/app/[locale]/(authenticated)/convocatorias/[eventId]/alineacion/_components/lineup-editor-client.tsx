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
  type LineupLocation,
  type OutReason,
  type PlayerPositionMain,
  type PositionAssignment,
  type TeamFormat,
} from '@misterfc/core';
import { Loader2, Plus, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import {
  MatchFieldEditor,
  type FieldEditorPlayer,
} from '@/components/match/match-field-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  applyCallupSync,
  createLineup,
  createPlannedSub,
  deleteLineupPosition,
  deletePlannedSub,
  resyncFromCallup,
  setLineupFormation,
  setLineupOfficial,
  setLineupVisibility,
  setTacticalNotes,
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
  visibility: 'staff' | 'team';
};

export type PlannedSubVM = {
  id: string;
  minutePlanned: number;
  playerOutId: string;
  playerInId: string;
  positionCodeTarget: string | null;
};

type Props = {
  eventId: string;
  format: TeamFormat;
  roster: RosterPlayerVM[];
  lineups: LineupSummaryVM[];
  selectedLineupId: string | null;
  selectedFormationCode: string | null;
  selectedIsOfficial: boolean;
  selectedVisibility: 'staff' | 'team';
  initialPositions: PositionAssignment[];
  initialTacticalNotes: string | null;
  initialPlannedSubs: PlannedSubVM[];
  callupPublished: boolean;
};

function shortLabel(p: RosterPlayerVM | undefined, playerId: string): string {
  if (!p) return playerId.slice(0, 4);
  return p.lastName || p.firstName || playerId.slice(0, 4);
}

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
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-24 flex-col gap-1.5 rounded-md border border-dashed border-border p-2 transition-colors',
        isOver && 'border-emerald-500 bg-emerald-500/10',
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
  positionLabel,
}: {
  playerId: string;
  label: string;
  dorsal: number | null;
  positionLabel: string | null;
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
      {positionLabel && (
        <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
          {positionLabel}
        </span>
      )}
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
    selectedVisibility,
    initialPositions,
    initialTacticalNotes,
    initialPlannedSubs,
    callupPublished,
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

  const posLabelOf = (playerId: string): string | null => {
    const pm = rosterById.get(playerId)?.positionMain;
    return pm ? t(`pos_short.${pm}`) : null;
  };

  const [positions, setPositions] = useState<PositionAssignment[]>(() =>
    mergeInitial(initialPositions, roster),
  );
  const [formationCode, setFormationCode] = useState<string>(
    selectedFormationCode ?? defaultFormation(format).code,
  );
  const [visibility, setVisibility] = useState<'staff' | 'team'>(selectedVisibility);
  const [notes, setNotes] = useState<string>(initialTacticalNotes ?? '');
  const [showNotes, setShowNotes] = useState<boolean>(
    (initialTacticalNotes ?? '').length > 0,
  );
  const [plannedSubs, setPlannedSubs] = useState<PlannedSubVM[]>(initialPlannedSubs);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState<
    { playerId: string; location: LineupLocation; outReason: OutReason | null }[] | null
  >(null);

  // Form de cambio programado.
  const [subMinute, setSubMinute] = useState('');
  const [subOut, setSubOut] = useState('');
  const [subIn, setSubIn] = useState('');
  const [subPos, setSubPos] = useState('');

  const [newName, setNewName] = useState('Titular');
  const [newFormation, setNewFormation] = useState<string>(
    defaultFormation(format).code,
  );

  const formations = useMemo(() => formationsForFormat(format), [format]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // ── Estado vacío: crear primera alineación ───────────────────────────────
  if (selectedLineupId == null) {
    return (
      <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">{t('empty_hint')}</p>
        <label className="text-xs font-medium">{t('name_label')}</label>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
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
      positionLabel: posLabelOf(p.playerId),
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

  // F6.6 — sincroniza el descarte/convocado de la convocatoria para las
  // transiciones que cruzan la frontera "out".
  function runCallupSync(
    items: { playerId: string; location: LineupLocation; outReason: OutReason | null }[],
    confirm: boolean,
  ) {
    startTransition(async () => {
      let discarded = 0;
      let calledUp = 0;
      for (const it of items) {
        const r = await applyCallupSync({
          event_id: eventId,
          player_id: it.playerId,
          location: it.location,
          out_reason: it.outReason,
          confirm,
        });
        if (r.error) {
          setError(r.error);
          return;
        }
        if (r.needsConfirm) {
          setConfirmSync(items);
          return;
        }
        if (r.decision === 'discarded') discarded += 1;
        else calledUp += 1;
      }
      const parts: string[] = [];
      if (discarded > 0) parts.push(t('auto_discarded', { n: discarded }));
      if (calledUp > 0) parts.push(t('auto_called_up', { n: calledUp }));
      setAutoMsg(parts.join(' · '));
    });
  }

  function syncOutTransitions(
    prev: PositionAssignment[],
    next: PositionAssignment[],
    changed: string[],
  ) {
    const transitions = changed
      .map((pid) => {
        const before = prev.find((p) => p.playerId === pid)?.location;
        const after = next.find((p) => p.playerId === pid)!;
        return { playerId: pid, before, location: after.location, outReason: after.outReason };
      })
      .filter((tr) => (tr.location === 'out') !== (tr.before === 'out'))
      .map((tr) => ({ playerId: tr.playerId, location: tr.location, outReason: tr.outReason }));
    if (transitions.length === 0) return;
    if (callupPublished) setConfirmSync(transitions);
    else runCallupSync(transitions, false);
  }

  function onDragEnd(e: DragEndEvent) {
    const drop = resolveDrop(String(e.active.id), e.over ? String(e.over.id) : null);
    if (!drop) return;
    const prev = positions;
    const { next, changed } = applyDrop(prev, drop, formation);
    if (changed.length === 0) return;
    setPositions(next);
    persist(next, changed, prev);
    syncOutTransitions(prev, next, changed);
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
      }
    });
  }

  function onToggleOfficial(value: boolean) {
    startTransition(async () => {
      const r = await setLineupOfficial({ lineup_id: lineupId, is_official: value });
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  function onToggleVisibility(value: boolean) {
    const next = value ? 'team' : 'staff';
    setVisibility(next);
    startTransition(async () => {
      const r = await setLineupVisibility({ lineup_id: lineupId, visibility: next });
      if (r.error) {
        setVisibility(value ? 'staff' : 'team');
        setError(r.error);
      }
    });
  }

  function saveNotes() {
    startTransition(async () => {
      const r = await setTacticalNotes({ lineup_id: lineupId, notes: notes.trim() || null });
      if (r.error) setError(r.error);
    });
  }

  function onResync() {
    startTransition(async () => {
      setError(null);
      const r = await resyncFromCallup(lineupId);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.positions) {
        setPositions(
          r.positions.map((p) => ({
            playerId: p.playerId,
            location: p.location,
            positionCode: p.positionCode,
            xPct: p.xPct,
            yPct: p.yPct,
            outReason: (p.outReason as OutReason | null) ?? null,
          })),
        );
      }
      setAutoMsg(t('resync_done', { out: r.toOut ?? 0, bench: r.toBench ?? 0 }));
    });
  }

  function addPlannedSub() {
    const minute = Number(subMinute);
    if (!subOut || !subIn || subOut === subIn || !Number.isFinite(minute)) return;
    startTransition(async () => {
      const r = await createPlannedSub({
        lineup_id: lineupId,
        minute_planned: minute,
        player_out_id: subOut,
        player_in_id: subIn,
        position_code_target: subPos || null,
      });
      if (r.error || !r.subId) {
        setError(r.error ?? 'generic');
        return;
      }
      setPlannedSubs((prev) =>
        [
          ...prev,
          {
            id: r.subId!,
            minutePlanned: minute,
            playerOutId: subOut,
            playerInId: subIn,
            positionCodeTarget: subPos || null,
          },
        ].sort((a, b) => a.minutePlanned - b.minutePlanned),
      );
      setSubMinute('');
      setSubOut('');
      setSubIn('');
      setSubPos('');
    });
  }

  function removePlannedSub(id: string) {
    setPlannedSubs((prev) => prev.filter((s) => s.id !== id));
    startTransition(async () => {
      const r = await deletePlannedSub({ id });
      if (r.error) setError(r.error);
    });
  }

  const fieldAndBench = positions.filter((p) => p.location !== 'out');

  return (
    <div className="flex flex-col gap-3">
      {/* Controles superiores */}
      <div className="flex flex-wrap items-center gap-3">
        {lineups.length > 1 && (
          <Select value={lineupId} onValueChange={(id) => router.push(`${pathname}?lineup=${id}`)}>
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
          <Switch checked={selectedIsOfficial} onCheckedChange={onToggleOfficial} disabled={pending} />
          {t('official_label')}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={visibility === 'team'} onCheckedChange={onToggleVisibility} disabled={pending} />
          {t('share_label')}
        </label>

        <Button variant="outline" size="sm" disabled={pending} onClick={onResync}>
          <RefreshCw className="size-4" aria-hidden />
          {t('resync')}
        </Button>

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

      {autoMsg && (
        <p className="rounded-md border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground" role="status">
          {autoMsg}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_1fr]">
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
                    positionLabel={posLabelOf(p.playerId)}
                  />
                ))
              )}
            </DropZone>
          </section>

          <section>
            <MatchFieldEditor
              format={format}
              formationCode={formationCode}
              players={fieldPlayers}
              mode="edit"
            />
          </section>

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
                      positionLabel={posLabelOf(p.playerId)}
                    />
                    <div className="flex items-center gap-1 pl-1">
                      <Select value={p.outReason ?? 'tecnico'} onValueChange={(v) => changeOutReason(p.playerId, v as OutReason)}>
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
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('remove')} onClick={() => removeFromLineup(p.playerId)}>
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

      {/* Cambios programados (F6.8) */}
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">
          {t('planned_subs')} · {plannedSubs.length}
        </h3>
        {plannedSubs.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {plannedSubs.map((s) => {
              const out = rosterById.get(s.playerOutId);
              const inn = rosterById.get(s.playerInId);
              return (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span>
                    {t('sub_line', {
                      minute: s.minutePlanned,
                      out: shortLabel(out, s.playerOutId),
                      in: shortLabel(inn, s.playerInId),
                    })}
                    {s.positionCodeTarget ? ` (${s.positionCodeTarget})` : ''}
                  </span>
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('remove')} onClick={() => removePlannedSub(s.id)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_minute')}</label>
            <Input className="h-8 w-16" type="number" min={0} max={120} value={subMinute} onChange={(e) => setSubMinute(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_out')}</label>
            <Select value={subOut} onValueChange={setSubOut}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {fieldAndBench.map((p) => (
                  <SelectItem key={p.playerId} value={p.playerId}>
                    {shortLabel(rosterById.get(p.playerId), p.playerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground">{t('sub_in')}</label>
            <Select value={subIn} onValueChange={setSubIn}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {benchPlayers.map((p) => (
                  <SelectItem key={p.playerId} value={p.playerId}>
                    {shortLabel(rosterById.get(p.playerId), p.playerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" size="sm" disabled={pending || !subOut || !subIn || subOut === subIn || subMinute === ''} onClick={addPlannedSub}>
            <Plus className="size-4" aria-hidden />
            {t('sub_add')}
          </Button>
        </div>
      </section>

      {/* Notas tácticas (F6.9) — solo staff */}
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <button type="button" className="flex items-center justify-between text-sm font-semibold" onClick={() => setShowNotes((v) => !v)}>
          <span>{t('tactical_notes')}</span>
          <span className="text-xs text-muted-foreground">{showNotes ? '−' : '+'}</span>
        </button>
        {showNotes && (
          <div className="flex flex-col gap-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={4} placeholder={t('tactical_notes_placeholder')} />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{t('tactical_notes_staff_only')}</span>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={saveNotes}>
                {t('save_notes')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Confirmación de sincronización con convocatoria publicada (F6.6) */}
      <Dialog open={confirmSync != null} onOpenChange={(o) => !o && setConfirmSync(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirm_published_title')}</DialogTitle>
            <DialogDescription>{t('confirm_published_body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSync(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                const items = confirmSync ?? [];
                setConfirmSync(null);
                runCallupSync(items, true);
              }}
            >
              {t('confirm_apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
