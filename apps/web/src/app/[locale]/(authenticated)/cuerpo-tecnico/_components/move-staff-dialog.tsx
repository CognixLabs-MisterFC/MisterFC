'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { TEAM_STAFF_ROLES, type TeamStaffRole } from '@misterfc/core';
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
import { moveStaffToTeam, type MoveStaffState } from '../actions';

type TeamOption = {
  id: string;
  name: string;
  category_name: string;
};

type Props = {
  membershipId: string;
  teamStaffId: string;
  currentTeamId: string;
  currentStaffRole: TeamStaffRole;
  targets: TeamOption[];
  /**
   * E-final-2: roles ofrecibles como destino del movimiento. Para el coordinador
   * se pasa TEAM_STAFF_ROLES sin 'coordinador' (la RLS de team_staff se lo rechaza);
   * admin/director reciben la lista completa (default).
   */
  assignableRoles?: readonly TeamStaffRole[];
  /** Variante compacta para la tabla del listado. */
  compact?: boolean;
};

export function MoveStaffDialog({
  membershipId,
  teamStaffId,
  currentTeamId,
  currentStaffRole,
  targets,
  assignableRoles = TEAM_STAFF_ROLES,
  compact = false,
}: Props) {
  const t = useTranslations('cuerpo_tecnico.move');
  const tRole = useTranslations('staff.role');
  const [open, setOpen] = useState(false);

  const action = moveStaffToTeam.bind(null, membershipId);
  const [state, formAction, pending] = useActionState<MoveStaffState, FormData>(
    action,
    {}
  );

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;
  const candidates = targets.filter((t) => t.id !== currentTeamId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          className="gap-2"
        >
          <ArrowRightLeft className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="team_staff_id" value={teamStaffId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="ms-team">{t('field.team')}</Label>
            <Select name="target_team_id" required>
              <SelectTrigger id="ms-team">
                <SelectValue placeholder={t('field.team_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((tm) => (
                  <SelectItem key={tm.id} value={tm.id}>
                    {tm.name} · {tm.category_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ms-role">{t('field.staff_role')}</Label>
            <Select name="staff_role" defaultValue={currentStaffRole} required>
              <SelectTrigger id="ms-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tRole(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('field.staff_role_help')}
            </p>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
