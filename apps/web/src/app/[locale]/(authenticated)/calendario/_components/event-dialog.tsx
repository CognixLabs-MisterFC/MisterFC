'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  ClipboardList,
  Loader2,
  Megaphone,
  Plus,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  EVENT_TYPES,
  type EventInput,
  type EventType,
  type RecurrenceRuleInput,
  countOccurrences,
  isManageableMatchType,
  TIMEZONE_OLA1,
  computeEndsAt,
  HALFTIME_BREAK_MINUTES,
} from '@misterfc/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  isoToLocalInput,
  localInputToIso,
  parseIsoDate,
} from '@/lib/calendar-utils';
import { createEvent, updateEvent } from '../actions';
import type {
  CalendarEvent,
  CategoryOption,
  TeamOption,
} from '../queries';
import { EventDeleteDialog } from './event-delete-dialog';

type Mode = 'new' | 'edit';

type Props = {
  mode: Mode;
  /** En "new" puede venir el día seleccionado para prefill. */
  defaultDateIso?: string;
  /** En "edit" el evento existente. */
  event?: CalendarEvent;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  locale: string;
  canManage: boolean;
  manageableTeamIds: string[];
  canManageClubEvents: boolean;
  teams: TeamOption[];
  categories: CategoryOption[];
  /** Opcional: trigger custom. Si no se provee, el componente provee un botón "Nuevo". */
  triggerLabel?: string;
};

type TargetKind = 'team' | 'category' | 'club';

// 0=lunes ... 6=domingo en ISO. El form de UI también usa ISO.
const WEEKDAYS_ISO = [0, 1, 2, 3, 4, 5, 6] as const;

export function EventDialog({
  mode,
  defaultDateIso,
  event,
  open: controlledOpen,
  onOpenChange,
  locale,
  canManage,
  manageableTeamIds,
  canManageClubEvents,
  teams,
  categories,
  triggerLabel,
}: Props) {
  const t = useTranslations('calendario');
  const tTypes = useTranslations('calendario.types');
  const tErrors = useTranslations('calendario.dialog.errors');

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Estado del form ─────────────────────────────────────────────────────
  const initialKind: TargetKind = useMemo(() => {
    if (event?.team_id) return 'team';
    if (event?.category_id) return 'category';
    if (event && !event.team_id && !event.category_id) return 'club';
    // Modo new: si tiene equipos asignables, default team; si solo club, club.
    return manageableTeamIds.length > 0 ? 'team' : 'club';
  }, [event, manageableTeamIds]);

  const [type, setType] = useState<EventType>(event?.type ?? 'training');
  const [title, setTitle] = useState(event?.title ?? '');
  const [targetKind, setTargetKind] = useState<TargetKind>(initialKind);
  const [teamId, setTeamId] = useState<string>(
    event?.team_id ?? manageableTeamIds[0] ?? ''
  );
  const [categoryId, setCategoryId] = useState<string>(
    event?.category_id ?? categories[0]?.id ?? ''
  );

  const defaultStart = event?.starts_at
    ? isoToLocalInput(event.starts_at)
    : defaultDateIso
      ? `${defaultDateIso}T18:00`
      : `${todayIso()}T18:00`;
  const defaultEnd = event?.ends_at
    ? isoToLocalInput(event.ends_at)
    : '';

  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [locationName, setLocationName] = useState(event?.location_name ?? '');
  const [locationAddress, setLocationAddress] = useState(
    event?.location_address ?? ''
  );
  const [opponentName, setOpponentName] = useState(
    event?.opponent_name ?? ''
  );
  const [notes, setNotes] = useState(event?.notes ?? '');

  // Recurrencia
  const initialRule = (event?.recurrence_rule ?? null) as RecurrenceRuleInput | null;
  const [recurEnabled, setRecurEnabled] = useState(initialRule != null);
  const [interval, setInterval] = useState<number>(initialRule?.interval ?? 1);
  const [byWeekday, setByWeekday] = useState<number[]>(
    initialRule?.by_weekday ?? [],
  );
  const [recurMode, setRecurMode] = useState<'count' | 'until'>(
    initialRule?.until != null ? 'until' : 'count'
  );
  const [count, setCount] = useState<number>(initialRule?.count ?? 10);
  const [until, setUntil] = useState<string>(initialRule?.until ?? '');

  // Update mode (solo si event existe y forma parte de una serie)
  const isRecurring =
    event != null && (event.parent_event_id != null || event.recurrence_rule != null);
  const [updateMode, setUpdateMode] = useState<
    'single' | 'this_and_future' | 'series'
  >('single');

  // ── Filtrado de targets según rol ───────────────────────────────────────
  const allowedTeams = useMemo(() => {
    return teams.filter((tm) => manageableTeamIds.includes(tm.id));
  }, [teams, manageableTeamIds]);

  // F4.9 — half_duration_minutes del target activo (team o category):
  // - team → su categoría.
  // - category → directa.
  // - club → null (no sabemos qué duración aplicar).
  const targetHalfDuration = useMemo<number | null>(() => {
    if (targetKind === 'team') {
      const tm = teams.find((t) => t.id === teamId);
      return tm?.half_duration_minutes ?? null;
    }
    if (targetKind === 'category') {
      const c = categories.find((cat) => cat.id === categoryId);
      return c?.half_duration_minutes ?? null;
    }
    return null;
  }, [targetKind, teamId, categoryId, teams, categories]);

  // F4.9 — Auto-rellenar ends_at para type=match: la sugerencia se computa
  // derivada durante render (sin useEffect, para cumplir con el lint
  // `react-hooks/set-state-in-effect`). El input lee `effectiveEndsAt`:
  // si el usuario aún no ha tocado el campo (`endsAtTouched=false`),
  // muestra la sugerencia; si ha editado manualmente, respeta su valor.
  // El evento ya existente con ends_at viene "tocado" para no machacar.
  const [endsAtTouched, setEndsAtTouched] = useState<boolean>(
    () => Boolean(event?.ends_at),
  );

  const autoEndsAtSuggestion = useMemo<string | null>(() => {
    if (type !== 'match' || !startsAt || targetHalfDuration == null) return null;
    let startIso: string;
    try {
      startIso = localInputToIso(startsAt);
    } catch {
      return null;
    }
    const suggested = computeEndsAt(startIso, targetHalfDuration);
    return suggested ? isoToLocalInput(suggested) : null;
  }, [type, startsAt, targetHalfDuration]);

  const effectiveEndsAt =
    endsAtTouched || autoEndsAtSuggestion == null ? endsAt : autoEndsAtSuggestion;

  // ── Cálculo de número de ocurrencias previas a guardar ──────────────────
  const occurrencesPreview = useMemo(() => {
    if (mode !== 'new' || !recurEnabled) return null;
    if (byWeekday.length === 0) return null;
    try {
      const startIso = localInputToIso(startsAt);
      const rule: RecurrenceRuleInput = {
        freq: 'weekly',
        interval,
        by_weekday: byWeekday,
        ...(recurMode === 'count' ? { count } : { until }),
      };
      return countOccurrences(new Date(startIso), rule, TIMEZONE_OLA1);
    } catch {
      return null;
    }
  }, [
    mode,
    recurEnabled,
    interval,
    byWeekday,
    recurMode,
    count,
    until,
    startsAt,
  ]);

  function buildInput(): EventInput | null {
    if (!title.trim()) return null;
    let target: EventInput['target'];
    if (targetKind === 'team') {
      if (!teamId) return null;
      target = { kind: 'team', team_id: teamId };
    } else if (targetKind === 'category') {
      if (!categoryId) return null;
      target = { kind: 'category', category_id: categoryId };
    } else {
      target = { kind: 'club' };
    }
    let startIso: string;
    let endIso: string | null;
    try {
      startIso = localInputToIso(startsAt);
      endIso = effectiveEndsAt ? localInputToIso(effectiveEndsAt) : null;
    } catch {
      return null;
    }
    let recurrence_rule: RecurrenceRuleInput | null = null;
    if (mode === 'new' && recurEnabled) {
      if (byWeekday.length === 0) return null;
      recurrence_rule = {
        freq: 'weekly',
        interval,
        by_weekday: [...byWeekday].sort((a, b) => a - b),
        ...(recurMode === 'count'
          ? { count: Number(count) }
          : { until }),
      };
    }
    const opponent =
      opponentName.trim().length > 0 ? opponentName.trim() : null;
    return {
      type,
      target,
      title: title.trim(),
      starts_at: startIso,
      ends_at: endIso,
      all_day: allDay,
      location_name:
        locationName.trim().length > 0 ? locationName.trim() : null,
      location_address:
        locationAddress.trim().length > 0 ? locationAddress.trim() : null,
      opponent_name: opponent,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      recurrence_rule,
    };
  }

  function submit() {
    setError(null);
    const input = buildInput();
    if (!input) {
      setError(tErrors('invalid_input'));
      return;
    }
    startTransition(async () => {
      let result;
      if (mode === 'new') {
        result = await createEvent(input);
      } else {
        result = await updateEvent(event!.id, updateMode, input);
      }
      if (!result.success) {
        setError(tErrors(result.error));
        return;
      }
      setOpen(false);
    });
  }

  function toggleWeekday(iso: number) {
    setByWeekday((prev) => {
      const set = new Set(prev);
      if (set.has(iso)) set.delete(iso);
      else set.add(iso);
      return [...set];
    });
  }

  const isEdit = mode === 'edit';
  const readonly = isEdit && !canManage;

  // Snapshot mount-time de "el evento ya empezó". Date.now() y new Date()
  // son impuros: dentro de useMemo react-hooks/purity los rechaza (la regla
  // del React Compiler trata el body de useMemo como render-puro). useState
  // con init function es la vía idiomática para snapshot-on-mount; el
  // initializer queda fuera del scope de pureza.
  const [isPastEvent] = useState<boolean>(() => {
    if (!event?.starts_at) return false;
    return new Date(event.starts_at).getTime() <= Date.now();
  });

  // Render trigger por defecto si no es controlado externamente
  const trigger = controlledOpen === undefined && !isEdit && (
    <DialogTrigger asChild>
      <Button>
        <Plus className="size-4" aria-hidden />
        <span>{triggerLabel ?? t('new.trigger')}</span>
      </Button>
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('dialog.edit_title') : t('dialog.new_title')}
          </DialogTitle>
          <DialogDescription>
            {readonly
              ? t('dialog.readonly_description')
              : t('dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="ev-type">{t('dialog.field.type')}</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as EventType)}
              disabled={readonly}
            >
              <SelectTrigger id="ev-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {tTypes(ty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ev-title">{t('dialog.field.title')}</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              disabled={readonly}
            />
          </div>

          {!readonly && (
            <div className="grid gap-2">
              <Label>{t('dialog.field.target')}</Label>
              <div className="flex flex-wrap gap-2">
                {allowedTeams.length > 0 && (
                  <TargetButton
                    label={t('dialog.target.team')}
                    active={targetKind === 'team'}
                    onClick={() => setTargetKind('team')}
                  />
                )}
                {canManageClubEvents && (
                  <TargetButton
                    label={t('dialog.target.category')}
                    active={targetKind === 'category'}
                    onClick={() => setTargetKind('category')}
                  />
                )}
                {canManageClubEvents && (
                  <TargetButton
                    label={t('dialog.target.club')}
                    active={targetKind === 'club'}
                    onClick={() => setTargetKind('club')}
                  />
                )}
              </div>
              {targetKind === 'team' && allowedTeams.length > 0 && (
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTeams.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.name} · {tm.category_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {targetKind === 'category' && categories.length > 0 && (
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
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
              )}
            </div>
          )}

          {readonly && (
            <div className="grid gap-1 text-sm">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('dialog.field.target')}
              </Label>
              <span>
                {event?.team_name ?? event?.category_name ?? t('dialog.target.club')}
              </span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ev-starts">{t('dialog.field.starts_at')}</Label>
              <Input
                id="ev-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
                disabled={readonly}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-ends">{t('dialog.field.ends_at')}</Label>
              <Input
                id="ev-ends"
                type="datetime-local"
                value={effectiveEndsAt}
                onChange={(e) => {
                  // F4.9 — al editar manualmente, dejamos de mostrar la
                  // sugerencia auto. setEndsAt + setEndsAtTouched(true).
                  setEndsAt(e.target.value);
                  setEndsAtTouched(true);
                }}
                disabled={readonly}
              />
              {type === 'match' && targetHalfDuration != null && !endsAtTouched && (
                <p className="text-xs text-muted-foreground">
                  {t('dialog.field.ends_at_auto', {
                    minutes: 2 * targetHalfDuration + HALFTIME_BREAK_MINUTES,
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="ev-all-day" className="text-sm">
              {t('dialog.field.all_day')}
            </Label>
            <Switch
              id="ev-all-day"
              checked={allDay}
              onCheckedChange={setAllDay}
              disabled={readonly}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ev-loc-name">{t('dialog.field.location_name')}</Label>
              <Input
                id="ev-loc-name"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                maxLength={160}
                disabled={readonly}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-loc-addr">
                {t('dialog.field.location_address')}
              </Label>
              <Input
                id="ev-loc-addr"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                maxLength={240}
                disabled={readonly}
              />
            </div>
          </div>

          {(type === 'match' || type === 'friendly') && (
            <div className="grid gap-2">
              <Label htmlFor="ev-opp">{t('dialog.field.opponent_name')}</Label>
              <Input
                id="ev-opp"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                maxLength={120}
                disabled={readonly}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="ev-notes">{t('dialog.field.notes')}</Label>
            <textarea
              id="ev-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={readonly}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm disabled:opacity-60"
            />
          </div>

          {/* Recurrencia: solo en modo new (no se permite cambiar la regla en edit en F3) */}
          {mode === 'new' && !readonly && (
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Label htmlFor="ev-recur" className="text-sm">
                    {t('dialog.recurrence.label')}
                  </Label>
                </div>
                <Switch
                  id="ev-recur"
                  checked={recurEnabled}
                  onCheckedChange={setRecurEnabled}
                />
              </div>

              {recurEnabled && (
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      {t('dialog.recurrence.weekdays')}
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAYS_ISO.map((iso) => {
                        const active = byWeekday.includes(iso);
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => toggleWeekday(iso)}
                            className={
                              'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium ' +
                              (active
                                ? 'bg-foreground text-background'
                                : 'border border-border text-muted-foreground hover:bg-muted')
                            }
                          >
                            {t(`dialog.recurrence.day_short.${iso}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t('dialog.recurrence.interval')}
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        value={interval}
                        onChange={(e) =>
                          setInterval(parseInt(e.target.value, 10) || 1)
                        }
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t('dialog.recurrence.end')}
                      </Label>
                      <Select
                        value={recurMode}
                        onValueChange={(v) =>
                          setRecurMode(v as 'count' | 'until')
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="count">
                            {t('dialog.recurrence.end_count')}
                          </SelectItem>
                          <SelectItem value="until">
                            {t('dialog.recurrence.end_until')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {recurMode === 'count' ? (
                    <div className="grid gap-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t('dialog.recurrence.count_label')}
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={52}
                        value={count}
                        onChange={(e) =>
                          setCount(parseInt(e.target.value, 10) || 1)
                        }
                      />
                    </div>
                  ) : (
                    <div className="grid gap-1.5">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t('dialog.recurrence.until_label')}
                      </Label>
                      <Input
                        type="date"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                      />
                    </div>
                  )}

                  {occurrencesPreview != null && (
                    <p className="text-xs text-muted-foreground">
                      {t('dialog.recurrence.preview', {
                        count: occurrencesPreview,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Modo de update si forma parte de serie */}
          {mode === 'edit' && isRecurring && !readonly && (
            <div className="rounded-md border border-border p-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('dialog.update_scope.label')}
              </Label>
              <div className="mt-2 flex flex-col gap-2">
                {(['single', 'this_and_future', 'series'] as const).map(
                  (m) => (
                    <label
                      key={m}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="update-scope"
                        value={m}
                        checked={updateMode === m}
                        onChange={() => setUpdateMode(m)}
                      />
                      <span>{t(`dialog.update_scope.${m}`)}</span>
                    </label>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {isEdit && canManage && event && (
            <div className="mr-auto">
              <EventDeleteDialog
                eventId={event.id}
                isRecurring={isRecurring}
                onDeleted={() => setOpen(false)}
              />
            </div>
          )}
          {/* F4 entry point: si es un entrenamiento ya finalizado y el user
              gestiona el team, link directo a la pantalla de marcar
              asistencia. */}
          {isEdit &&
            event &&
            event.type === 'training' &&
            isPastEvent &&
            canManage && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/asistencia/${event.id}`}
                  onClick={() => setOpen(false)}
                >
                  <ClipboardList className="size-4" aria-hidden />
                  <span>{t('dialog.mark_attendance')}</span>
                </Link>
              </Button>
            )}
          {/* F4.4 entry point: si es un partido gestionable (oficial, amistoso
              o torneo), link a la convocatoria. */}
          {isEdit && event && isManageableMatchType(event.type) && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/convocatorias/${event.id}`}
                onClick={() => setOpen(false)}
              >
                <Megaphone className="size-4" aria-hidden />
                <span>{t('dialog.open_callup')}</span>
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t('dialog.cancel')}
          </Button>
          {!readonly && (
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('dialog.save')}</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Locale is forwarded to subcomponents; unused suppressed via void.
  void locale;
}

function TargetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-md border px-3 py-1.5 text-sm transition ' +
        (active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted')
      }
    >
      {label}
    </button>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  void parseIsoDate; // forward import for tree-shaking awareness
  return `${y}-${m}-${day}`;
}
