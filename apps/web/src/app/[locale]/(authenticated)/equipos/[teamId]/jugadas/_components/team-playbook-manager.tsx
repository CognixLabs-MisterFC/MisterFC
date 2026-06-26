'use client';

/**
 * JR-2 (ADR-0019) — Gestión del playbook del equipo (cliente). El staff del equipo:
 * - ve las jugadas que el equipo ha seleccionado del banco y puede QUITARLAS;
 * - togglea "compartir con la familia" por jugada (al activarlo, se notifica);
 * - AÑADE jugadas publicadas del banco (buscador) a su equipo.
 * El gate real es la RLS de team_plays (JR-0). Si !canManage (p.ej. admin/coord que
 * no es staff de ESTE equipo), se muestra en solo lectura. El editor/animación no
 * cambian: las jugadas enlazan al editor/visor existentes.
 */

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter } from '@/i18n/navigation';
import type { TeamSelectedPlay, AddablePlay } from '../../../../jugadas/queries';
import { addPlayToTeam, removePlayFromTeam, setPlayShared } from '../actions';

export function TeamPlaybookManager({
  teamId,
  canManage,
  selected,
  addable,
  addableTruncated,
}: {
  teamId: string;
  canManage: boolean;
  selected: TeamSelectedPlay[];
  addable: AddablePlay[];
  addableTruncated: boolean;
}) {
  const t = useTranslations('playbook_equipo');
  const tJ = useTranslations('jugadas');
  const tList = useTranslations('jugadas.list');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimista para el switch de compartir (evita parpadeo hasta el refresh).
  const [sharedOverride, setSharedOverride] = useState<Record<string, boolean>>({});

  function run(fn: () => Promise<{ error?: string; success?: boolean }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(tJ(`errors.${res.error}`));
        return;
      }
      toast.success(okMsg);
      router.refresh();
    });
  }

  function onToggleShare(playId: string, next: boolean) {
    setSharedOverride((m) => ({ ...m, [playId]: next }));
    run(
      () => setPlayShared({ teamId, playId, shared: next }, locale),
      next ? t('toast.shared') : t('toast.unshared'),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Jugadas del equipo ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Swords className="size-4" aria-hidden />
            {t('selected.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {selected.length === 0 ? (
            <p className="text-muted-foreground">{t('selected.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {selected.map((p) => {
                const shared = sharedOverride[p.play_id] ?? p.shared_with_family;
                return (
                  <li key={p.play_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.name ?? tJ('untitled')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {tList('frame_count', { count: p.frame_count })}
                      </span>
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`share-${p.play_id}`}
                          className="text-xs text-muted-foreground"
                        >
                          {t('share_label')}
                        </Label>
                        <Switch
                          id={`share-${p.play_id}`}
                          checked={shared}
                          disabled={pending}
                          onCheckedChange={(v) => onToggleShare(p.play_id, v)}
                          aria-label={t('share_label')}
                        />
                        <RemoveButton
                          disabled={pending}
                          labels={{
                            trigger: t('remove'),
                            title: t('confirm_remove.title'),
                            description: t('confirm_remove.description', {
                              name: p.name ?? tJ('untitled'),
                            }),
                            cancel: t('confirm_remove.cancel'),
                            confirm: t('remove'),
                          }}
                          onConfirm={() =>
                            run(
                              () => removePlayFromTeam({ teamId, playId: p.play_id }),
                              t('toast.removed'),
                            )
                          }
                        />
                      </div>
                    ) : (
                      <Badge variant={shared ? 'default' : 'secondary'} className="shrink-0">
                        {shared ? t('shared_badge') : t('not_shared_badge')}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Añadir del banco ─────────────────────────────────────────────── */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('add.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {addable.length === 0 ? (
              <p className="text-muted-foreground">{t('add.empty')}</p>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-border">
                  {addable.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {p.name ?? tJ('untitled')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tList('frame_count', { count: p.frame_count })}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => addPlayToTeam({ teamId, playId: p.id }), t('toast.added'))
                        }
                      >
                        <Plus className="size-4" aria-hidden />
                        {t('add.action')}
                      </Button>
                    </li>
                  ))}
                </ul>
                {addableTruncated && (
                  <p className="text-xs text-muted-foreground">{t('add.truncated')}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RemoveButton({
  disabled,
  labels,
  onConfirm,
}: {
  disabled: boolean;
  labels: { trigger: string; title: string; description: string; cancel: string; confirm: string };
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Trash2 className="size-4 text-destructive" aria-hidden />
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {labels.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
