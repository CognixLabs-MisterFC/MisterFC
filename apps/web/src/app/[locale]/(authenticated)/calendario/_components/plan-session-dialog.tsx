'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, NotebookPen, Plus, Link2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  loadPlanSessionOptions,
  planSessionForEvent,
  linkSessionToEvent,
  type LinkableSession,
} from '../../sesiones/actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  eventId: string;
  /** Cierra el diálogo del evento padre al navegar al editor. */
  onNavigate?: () => void;
};

/**
 * F12.8 (D2) — "Planificar sesión" desde un entrenamiento. Al abrir, carga las
 * opciones (¿ya hay sesión vinculada? + sesiones sueltas del equipo) y ofrece dos
 * caminos cuando no la hay: CREAR nueva (12.8a) o VINCULAR una existente. Si ya
 * tiene sesión, ofrece abrirla. La carga ocurre en el onClick del trigger (no en
 * useEffect) para respetar las reglas de hooks del proyecto.
 */
export function PlanSessionDialog({ eventId, onNavigate }: Props) {
  const t = useTranslations('calendario.dialog.plan');
  const tErr = useTranslations('calendario.dialog.errors');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LinkableSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  function openAndLoad() {
    setError(null);
    setSelectedId('');
    setLinkedId(null);
    setCandidates([]);
    setOpen(true);
    startTransition(async () => {
      const res = await loadPlanSessionOptions({ event_id: eventId });
      if (res.error) {
        setError(tErr('plan_failed'));
        return;
      }
      setLinkedId(res.linkedSessionId ?? null);
      setCandidates(res.candidates ?? []);
    });
  }

  function goToEditor(id: string) {
    setOpen(false);
    onNavigate?.();
    router.push(`/sesiones/${id}/editar`);
  }

  function createNew() {
    setError(null);
    startTransition(async () => {
      const res = await planSessionForEvent({ event_id: eventId });
      if (res.error || !res.id) {
        setError(tErr('plan_failed'));
        return;
      }
      goToEditor(res.id);
    });
  }

  function linkExisting() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      const res = await linkSessionToEvent({
        event_id: eventId,
        session_id: selectedId,
      });
      if (res.error || !res.id) {
        setError(res.error === 'conflict' ? tErr('link_conflict') : tErr('link_failed'));
        return;
      }
      goToEditor(res.id);
    });
  }

  function candidateLabel(s: LinkableSession): string {
    const name = s.title?.trim() ? s.title.trim() : t('untitled');
    return s.session_date ? `${name} · ${s.session_date}` : name;
  }

  // El primer transition es la carga; los siguientes son acciones. Distinguimos
  // "cargando opciones" (aún no hay datos) de "ejecutando acción".
  const loading = pending && linkedId === null && candidates.length === 0 && !error;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openAndLoad}
      >
        <NotebookPen className="size-4" aria-hidden />
        <span>{t('trigger')}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : linkedId ? (
            <div className="grid gap-4 py-2">
              <p className="text-sm text-muted-foreground">{t('already_linked')}</p>
              <Button type="button" onClick={() => goToEditor(linkedId)} disabled={pending}>
                <NotebookPen className="size-4" aria-hidden />
                <span>{t('open_session')}</span>
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 py-2">
              {/* Camino A — crear nueva (12.8a) */}
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('create_new')}</p>
                <p className="text-xs text-muted-foreground">{t('create_new_hint')}</p>
                <Button type="button" variant="outline" onClick={createNew} disabled={pending}>
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-4" aria-hidden />
                  )}
                  <span>{t('create_new_cta')}</span>
                </Button>
              </div>

              <div className="h-px bg-border" role="separator" />

              {/* Camino B — vincular una existente (12.8 D2) */}
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('link_existing')}</p>
                <p className="text-xs text-muted-foreground">{t('link_existing_hint')}</p>
                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('no_candidates')}</p>
                ) : (
                  <div className="grid gap-2">
                    <Select value={selectedId} onValueChange={setSelectedId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('select_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {candidateLabel(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      onClick={linkExisting}
                      disabled={pending || !selectedId}
                    >
                      {pending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Link2 className="size-4" aria-hidden />
                      )}
                      <span>{t('link_cta')}</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
