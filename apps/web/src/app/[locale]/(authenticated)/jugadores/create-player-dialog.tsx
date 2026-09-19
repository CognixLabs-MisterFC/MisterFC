'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  PLAYER_POSITIONS,
  PLAYER_FEET,
  PLAYER_TUTOR_RELATIONS,
} from '@misterfc/core';
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
import { createPlayer, type PlayerFormState } from './actions';
import {
  addPlayerLink,
  type AddPlayerLinkState,
} from '../cuerpo-tecnico/actions';

type Props = {
  teams: Array<{ id: string; name: string }>;
  /**
   * ¿Puede este usuario vincular jugadores a una cuenta? La RLS
   * `player_accounts_write_admin` es de admin_club/director; un entrenador
   * detecta que la persona ya existe (la RPC sí le contesta) pero no puede
   * hacer el vínculo, así que se le dice en vez de ofrecerle un botón que
   * fallaría.
   */
  canLinkPlayers: boolean;
};

export function CreatePlayerDialog({ teams, canLinkPlayers }: Props) {
  const t = useTranslations('jugadores');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // locale va por bind: createPlayer lo usa para el redirectTo del email de
  // invitación automática (/{locale}/invite/{token}).
  const [state, formAction, pending] = useActionState<PlayerFormState, FormData>(
    createPlayer.bind(null, locale),
    {}
  );

  // Cierra dialog y redirige a la ficha del nuevo jugador al guardar OK.
  // EXCEPTO si el tutor ya era miembro del club (B-2): ahí el alta termina con
  // una pregunta, así que no se puede navegar sin más.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success && state.playerId && !state.existingMember) {
      setOpen(false);
      router.push(`/jugadores/${state.playerId}`);
    }
  }

  const irAlJugador = (playerId: string) => {
    setOpen(false);
    router.push(`/jugadores/${playerId}`);
  };

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          <span>{t('create')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
          <DialogDescription>{t('create_help')}</DialogDescription>
        </DialogHeader>

        {state.existingMember && state.playerId ? (
          <ExistingMemberPanel
            member={state.existingMember}
            playerId={state.playerId}
            canLink={canLinkPlayers}
            onDone={irAlJugador}
          />
        ) : (
        <form action={formAction} className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            {t('field.legend')}
          </p>

          {/* ── Obligatorios ── */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-first-name">
                {t('field.first_name')} <Req />
              </Label>
              <Input
                id="cp-first-name"
                name="first_name"
                required
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-last-name">
                {t('field.last_name')} <Opt t={t} />
              </Label>
              <Input id="cp-last-name" name="last_name" maxLength={120} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cp-dob">
              {t('field.date_of_birth')} <Req />
            </Label>
            <Input id="cp-dob" name="date_of_birth" type="date" required />
            <p className="text-xs text-muted-foreground">
              {t('field.date_of_birth_help')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cp-team">
              {t('field.team')} <Req />
            </Label>
            <Select name="team_id" required>
              <SelectTrigger id="cp-team">
                <SelectValue placeholder={t('field.team_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((tm) => (
                  <SelectItem key={tm.id} value={tm.id}>
                    {tm.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {teams.length === 0 && (
              <p className="text-xs text-destructive">
                {t('field.team_none_available')}
              </p>
            )}
          </div>

          {/* ── Tutor (obligatorio: se le envía la invitación al crear) ── */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-email">
                {t('field.tutor_email')} <Req />
              </Label>
              <Input
                id="cp-email"
                name="invite_email"
                type="email"
                required
                maxLength={254}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-relation">
                {t('field.tutor_relation')} <Req />
              </Label>
              <Select name="player_relation" required>
                <SelectTrigger id="cp-relation">
                  <SelectValue placeholder={t('field.relation_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {PLAYER_TUTOR_RELATIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`tutor.relation.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('field.tutor_help')}
          </p>

          {/* ── Opcionales ── */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-dorsal">
                {t('field.dorsal')} <Opt t={t} />
              </Label>
              <Input
                id="cp-dorsal"
                name="dorsal"
                type="number"
                min={1}
                max={99}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-position">
                {t('field.position_main')} <Opt t={t} />
              </Label>
              <Select name="position_main">
                <SelectTrigger id="cp-position">
                  <SelectValue placeholder={t('field.optional')} />
                </SelectTrigger>
                <SelectContent>
                  {PLAYER_POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`positions.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:max-w-[50%]">
            <Label htmlFor="cp-foot">
              {t('field.foot')} <Opt t={t} />
            </Label>
            <Select name="foot">
              <SelectTrigger id="cp-foot">
                <SelectValue placeholder={t('field.optional')} />
              </SelectTrigger>
              <SelectContent>
                {PLAYER_FEET.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`feet.${f}`)}
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>{t('actions.create')}</span>
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Marca de campo obligatorio. */
function Req() {
  return (
    <span className="text-destructive" aria-hidden>
      *
    </span>
  );
}

/** Marca de campo opcional. */
function Opt({ t }: { t: (key: string) => string }) {
  return (
    <span className="text-xs font-normal text-muted-foreground">
      ({t('field.optional_tag')})
    </span>
  );
}


/**
 * BUG 3 · B-2 — el correo del tutor ya era de alguien del club, así que no se
 * le mandó ninguna invitación. El jugador SÍ está creado; lo que falta es el
 * vínculo, y se ofrece aquí mismo en vez de mandar a nadie a buscar una
 * pantalla: es la misma acción que "Agregar jugador" de la ficha
 * (`addPlayerLink`), con la persona y el jugador ya puestos.
 *
 * Los mensajes de error se leen del namespace de esa acción a propósito: es la
 * misma acción y fallan por lo mismo. Duplicarlos sería duplicar el mantenimiento.
 */
function ExistingMemberPanel({
  member,
  playerId,
  canLink,
  onDone,
}: {
  member: NonNullable<PlayerFormState['existingMember']>;
  playerId: string;
  canLink: boolean;
  onDone: (playerId: string) => void;
}) {
  const t = useTranslations('jugadores.existing_member');
  const tLink = useTranslations('cuerpo_tecnico.players.add');
  const tClubRole = useTranslations('roles');

  const action = addPlayerLink.bind(null, member.membershipId);
  const [state, formAction, pending] = useActionState<AddPlayerLinkState, FormData>(
    action,
    {}
  );

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) onDone(playerId);
  }

  const errorMsg = state.error ? tLink(`errors.${state.error}`) : null;

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
            <Button
              type="button"
              variant="ghost"
              onClick={() => onDone(playerId)}
            >
              {t('skip')}
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
            <Button type="button" onClick={() => onDone(playerId)}>
              {t('skip')}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}
