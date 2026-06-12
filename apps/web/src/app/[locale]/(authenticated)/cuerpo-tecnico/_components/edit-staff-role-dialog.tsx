'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck } from 'lucide-react';
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
  updateStaffRole,
  STAFF_CLUB_ROLES,
  type UpdateStaffRoleState,
} from '../actions';

type Props = {
  /** Profile del miembro a editar (target de la función SECURITY DEFINER). */
  targetProfileId: string;
  /** Rol de club actual (memberships.role). */
  currentRole: string;
  /** El target es el propio usuario (afecta a la nota de la guarda). */
  isSelf: boolean;
};

/**
 * Bug 2 · 2b — el admin cambia el ROL DE CLUB de un miembro. Solo se renderiza
 * para admin_club (lo decide la page), pero permite cambiar el rol de cualquier
 * miembro incluido uno mismo. La GUARDA del último admin la impone la función
 * SQL: si el cambio dejaría al club sin admin, devuelve would_remove_last_admin
 * y aquí se muestra como error sin romper nada.
 */
export function EditStaffRoleDialog({
  targetProfileId,
  currentRole,
  isSelf,
}: Props) {
  const t = useTranslations('cuerpo_tecnico.edit_role');
  const tRoles = useTranslations('roles');
  const [open, setOpen] = useState(false);

  const action = updateStaffRole.bind(null, targetProfileId);
  const [state, formAction, pending] = useActionState<
    UpdateStaffRoleState,
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
          <ShieldCheck className="size-4" aria-hidden />
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
            <Label htmlFor="staff-role">{t('field.role')}</Label>
            <select
              id="staff-role"
              name="new_role"
              defaultValue={currentRole}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {STAFF_CLUB_ROLES.map((r) => (
                <option key={r} value={r}>
                  {tRoles(r)}
                </option>
              ))}
            </select>
          </div>

          {isSelf && (
            <p className="text-xs text-muted-foreground">{t('self_hint')}</p>
          )}

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
