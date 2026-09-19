'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserPlus } from 'lucide-react';
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
import { addTeamStaff, type AddTeamStaffState } from './actions';

export type StaffCandidate = {
  membership_id: string;
  full_name: string;
  club_role: string;
};

/**
 * "Añadir staff" — la contraparte de invitar (BUG 3 · A-2). Se elige a alguien
 * que YA está en el club y se le da una función en este equipo: ni correo, ni
 * invitación, ni espera. El rol de club de esa persona no se toca.
 *
 * Hermano de `AddAssignmentDialog` (Cuerpo técnico), que hace lo mismo por el
 * otro lado: allí está fija la persona y se elige el equipo.
 */
export function AddStaffDialog({
  teamId,
  candidates,
  assignableRoles = TEAM_STAFF_ROLES,
}: {
  teamId: string;
  candidates: StaffCandidate[];
  /**
   * Funciones ofrecidas. El coordinador no nombra coordinadores: se lo impide la
   * RLS `team_staff_insert_admin`, así que tampoco se le ofrece.
   */
  assignableRoles?: readonly TeamStaffRole[];
}) {
  const t = useTranslations('staff.add');
  const tRole = useTranslations('staff.role');
  const tClubRole = useTranslations('roles');
  const [open, setOpen] = useState(false);

  const action = addTeamStaff.bind(null, teamId);
  const [state, formAction, pending] = useActionState<AddTeamStaffState, FormData>(
    action,
    {}
  );

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
          <UserPlus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ats-member">{t('field.member')}</Label>
              <Select name="membership_id" required>
                <SelectTrigger id="ats-member">
                  <SelectValue placeholder={t('field.member_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.membership_id} value={c.membership_id}>
                      {c.full_name} · {tClubRole(c.club_role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ats-role">{t('field.staff_role')}</Label>
              <Select name="team_staff_role" required>
                <SelectTrigger id="ats-role">
                  <SelectValue placeholder={t('field.staff_role_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
