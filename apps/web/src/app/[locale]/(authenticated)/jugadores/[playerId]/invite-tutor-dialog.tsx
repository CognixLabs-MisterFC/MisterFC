'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mail } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  inviteTutorForPlayer,
  type InviteTutorState,
} from '../actions';
import {
  addPlayerLink,
  type AddPlayerLinkState,
} from '../../cuerpo-tecnico/actions';

type Props = {
  locale: string;
  playerId: string;
  playerName: string;
  /** Solo admin/director pueden escribir en `player_accounts` (RLS). */
  canLinkPlayers: boolean;
};

/**
 * Dialog "Invitar tutor/familia" — F2.4 hotfix 2026-05-30: el form vive en un
 * subcomponente montado sólo cuando `open=true`. Garantiza reset completo del
 * estado entre opens (email, relation, error). Mismo patrón que
 * `InviteStaffDialog`.
 */
export function InviteTutorDialog({
  locale,
  playerId,
  playerName,
  canLinkPlayers,
}: Props) {
  const t = useTranslations('jugadores.tutor');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { player: playerName })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <InviteTutorForm
            locale={locale}
            playerId={playerId}
            canLinkPlayers={canLinkPlayers}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteTutorForm({
  locale,
  playerId,
  canLinkPlayers,
  onClose,
}: {
  locale: string;
  playerId: string;
  canLinkPlayers: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('jugadores.tutor');

  const action = inviteTutorForPlayer.bind(null, locale, playerId);
  const [state, formAction, pending] = useActionState<InviteTutorState, FormData>(
    action,
    {},
  );

  const [lastHandled, setLastHandled] = useState(state);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) setSentTo(state.ok.email);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  // El correo ya es de alguien del club: no se ha invitado a nadie. En vez de
  // un mensaje sin salida, se ofrece aquí mismo el vínculo con la ficha.
  if (state.existingMember) {
    return (
      <ExistingMemberPanel
        member={state.existingMember}
        playerId={playerId}
        canLink={canLinkPlayers}
        onClose={onClose}
      />
    );
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('sent', { email: sentTo })}</p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="it-email">{t('field.email')}</Label>
        <Input
          id="it-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="it-relation">{t('field.relation')}</Label>
        <Select name="relation" defaultValue="parent">
          <SelectTrigger id="it-relation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="parent">{t('relation.parent')}</SelectItem>
            <SelectItem value="guardian">{t('relation.guardian')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('field.help')}</p>
      </div>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{t('send')}</span>
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * BUG 3 · B-2 (hueco hermano de #646) — la persona ya está en el club, así que
 * la invitación se sustituye por el vínculo directo: la misma acción de la
 * ficha del miembro (`addPlayerLink`), con la persona, el jugador y la relación
 * ya puestos. Quien no puede escribir en `player_accounts` ve a quién pedírselo
 * en vez de un botón que devolvería 'forbidden'.
 */
function ExistingMemberPanel({
  member,
  playerId,
  canLink,
  onClose,
}: {
  member: NonNullable<InviteTutorState['existingMember']>;
  playerId: string;
  canLink: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('jugadores.tutor.existing');
  const tTutor = useTranslations('jugadores.tutor');
  const tLink = useTranslations('cuerpo_tecnico.players.add');
  const tClubRole = useTranslations('roles');

  const action = addPlayerLink.bind(null, member.membershipId);
  const [state, formAction, pending] = useActionState<AddPlayerLinkState, FormData>(
    action,
    {},
  );

  const errorMsg = state.error ? tLink(`errors.${state.error}`) : null;

  if (state.success) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('linked', { name: member.fullName })}</p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {tTutor('close')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card/40 p-3">
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('body', {
            name: member.fullName,
            role: tClubRole(member.clubRole),
          })}
        </p>
      </div>

      {canLink ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="player_id" value={playerId} />
          <input type="hidden" name="relation" value={member.relation} />

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tTutor('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('link', { name: member.fullName })}</span>
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('no_permission')}</p>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {tTutor('close')}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}
