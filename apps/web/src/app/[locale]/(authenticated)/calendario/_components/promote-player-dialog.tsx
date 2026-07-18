'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  loadPromotionCandidates,
  loadPromotionConflicts,
  promotePlayer,
  type PromotionCandidate,
  type PromotionConflict,
  type PromotionEventInfo,
} from '../promotion-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  eventId: string;
  locale: string;
  /** Cierra el diálogo del evento padre al terminar. */
  onDone?: () => void;
};

/**
 * D2 — "Subir jugador" desde un evento del equipo SUPERIOR. Al abrir carga los
 * candidatos (jugadores de equipos inferiores del club) y el contexto del evento.
 * Al elegir un jugador, comprueba solapes de fecha y los muestra como AVISO (no
 * bloquea). Confirmar inserta la subida (el trigger valida "solo superior") y
 * dispara la notificación player_promoted a la familia. La carga ocurre en el
 * onClick del trigger (no en useEffect), como el resto de diálogos del proyecto.
 */
export function PromotePlayerDialog({ eventId, locale, onDone }: Props) {
  const t = useTranslations('promotions');
  // D-4b — mensaje de recarga ante un throw de transporte (skew de deploy / red).
  const tReload = useTranslations('calendario');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PromotionEventInfo | null>(null);
  const [candidates, setCandidates] = useState<PromotionCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [conflicts, setConflicts] = useState<PromotionConflict[]>([]);
  const [conflictsChecked, setConflictsChecked] = useState(false);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('');

  function fmt(iso: string): string {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso));
  }

  function openAndLoad() {
    setError(null);
    setLoaded(false);
    setEvent(null);
    setCandidates([]);
    setSelectedId('');
    setConflicts([]);
    setConflictsChecked(false);
    setSearch('');
    setTeamFilter('');
    setOpen(true);
    startTransition(async () => {
      try {
        const res = await loadPromotionCandidates(eventId);
        if (res.error) {
          setError(t('errors.load_failed'));
          setLoaded(true);
          return;
        }
        setEvent(res.event);
        setCandidates(res.candidates);
        setLoaded(true);
      } catch {
        setError(tReload('stale_reload'));
        setLoaded(true);
      }
    });
  }

  function onSelect(playerId: string) {
    setSelectedId(playerId);
    setConflicts([]);
    setConflictsChecked(false);
    setError(null);
    startTransition(async () => {
      try {
        const res = await loadPromotionConflicts(eventId, playerId);
        setConflicts(res.conflicts);
        setConflictsChecked(true);
      } catch {
        setError(tReload('stale_reload'));
      }
    });
  }

  function confirm() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await promotePlayer(eventId, selectedId);
        if (!res.success) {
          setError(t(`errors.${res.error}`));
          return;
        }
        setOpen(false);
        onDone?.();
        router.refresh();
      } catch {
        setError(tReload('stale_reload'));
      }
    });
  }

  function candidateLabel(c: PromotionCandidate): string {
    const name = `${c.first_name} ${c.last_name}`.trim();
    const team = c.base_team_name ? ` · ${c.base_team_name}` : '';
    const dorsal = c.dorsal != null ? ` #${c.dorsal}` : '';
    return `${name}${dorsal}${team}`;
  }

  const kindLabel = event?.kind ? t(`kind.${event.kind}`) : '';
  const loading = pending && !loaded && !error;

  // PASO 2 — filtro del picker: equipos base distintos + búsqueda por nombre.
  const teams = Array.from(
    new Set(candidates.map((c) => c.base_team_name).filter((n): n is string => !!n)),
  ).sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }));
  const q = search.trim().toLowerCase();
  const filtered = candidates.filter((c) => {
    const name = `${c.first_name} ${c.last_name}`.toLowerCase();
    return (
      (q === '' || name.includes(q)) &&
      (teamFilter === '' || c.base_team_name === teamFilter)
    );
  });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openAndLoad}>
        <ArrowUpCircle className="size-4" aria-hidden />
        <span>{t('trigger')}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {event
                ? t('description', {
                    team: event.team_name ?? '',
                    kind: kindLabel,
                  })
                : t('description_generic')}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : candidates.length === 0 && loaded && !error ? (
            <p className="py-4 text-sm text-muted-foreground">{t('no_candidates')}</p>
          ) : (
            <div className="grid gap-4 py-2">
              {/* PASO 2 — búsqueda por nombre + filtro por equipo base. */}
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('field.search_placeholder')}
                  aria-label={t('field.search_placeholder')}
                />
                {teams.length > 1 && (
                  <Select
                    value={teamFilter || '__all__'}
                    onValueChange={(v) => setTeamFilter(v === '__all__' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t('field.team_filter_all')}</SelectItem>
                      {teams.map((tm) => (
                        <SelectItem key={tm} value={tm}>
                          {tm}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('field.player')}</p>
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('no_matches')}</p>
                ) : (
                  <Select value={selectedId} onValueChange={onSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('field.player_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {filtered.map((c) => (
                        <SelectItem key={c.player_id} value={c.player_id}>
                          {candidateLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Aviso de conflicto de fecha (NO bloquea). */}
              {conflictsChecked && conflicts.length > 0 && (
                <div className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-4" aria-hidden />
                    {t('conflict.title')}
                  </p>
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {conflicts.map((c) => (
                      <li key={`${c.source}:${c.event_id}`}>
                        {[c.title, c.team_name, fmt(c.starts_at)]
                          .filter(Boolean)
                          .join(' · ')}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t('conflict.confirm_hint')}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={confirm} disabled={pending || !selectedId}>
              {pending && selectedId ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUpCircle className="size-4" aria-hidden />
              )}
              <span>
                {conflictsChecked && conflicts.length > 0
                  ? t('confirm_anyway')
                  : t('confirm')}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
