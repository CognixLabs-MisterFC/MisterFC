'use client';

/**
 * Serie C (C-0) — "Agregar rol": añade una asignación (equipo + staff_role) a una
 * membership existente SIN cerrar las demás. Permite multi-rol y 2 roles en el
 * mismo equipo. Solo se muestra a admin/director (gate en la page).
 */

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { TEAM_STAFF_ROLES } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addStaffAssignment, type AddAssignmentState } from '../actions';

type TeamOption = { id: string; name: string; category_name: string };

export function AddAssignmentDialog({
  membershipId,
  teams,
}: {
  membershipId: string;
  teams: TeamOption[];
}) {
  const t = useTranslations('cuerpo_tecnico.add_role');
  const tRole = useTranslations('staff.role');
  const [open, setOpen] = useState(false);

  const action = addStaffAssignment.bind(null, membershipId);
  const [state, formAction, pending] = useActionState<
    AddAssignmentState,
    FormData
  >(action, {});

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="aa-team">{t('field.team')}</Label>
            <Select name="target_team_id" required>
              <SelectTrigger id="aa-team">
                <SelectValue placeholder={t('field.team_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((tm) => (
                  <SelectItem key={tm.id} value={tm.id}>
                    {tm.name} · {tm.category_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="aa-role">{t('field.staff_role')}</Label>
            <Select name="staff_role" required>
              <SelectTrigger id="aa-role">
                <SelectValue placeholder={t('field.staff_role_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {TEAM_STAFF_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tRole(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
