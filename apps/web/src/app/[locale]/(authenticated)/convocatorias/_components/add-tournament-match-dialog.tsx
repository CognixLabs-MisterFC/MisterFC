'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { addTournamentMatch } from '../../calendario/actions';
import { localInputToIso } from '@/lib/calendar-utils';
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
import { Label } from '@/components/ui/label';

type Props = {
  /** Id de la CABECERA del torneo (evento type='tournament'). */
  tournamentId: string;
};

/**
 * F13B (T-4) — "Añadir siguiente partido" de un torneo, desde la convocatoria de
 * la cabecera. Formulario mínimo: fecha (obligatoria) + rival y lugar
 * (opcionales, el cruce siguiente suele conocerse después). Al confirmar crea el
 * partido (round=max+1, hereda la convocatoria de la cabecera por referencia) y
 * navega a su alineación, donde el banquillo ya sale sembrado desde la cabecera.
 */
export function AddTournamentMatchDialog({ tournamentId }: Props) {
  const t = useTranslations('convocatorias.tournament');
  const tErrors = useTranslations('calendario.errors');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [startsAt, setStartsAt] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setStartsAt('');
    setOpponentName('');
    setLocationName('');
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    if (!startsAt) {
      setError(tErrors('invalid_input'));
      return;
    }
    let startIso: string;
    try {
      startIso = localInputToIso(startsAt);
    } catch {
      setError(tErrors('invalid_input'));
      return;
    }
    startTransition(async () => {
      const res = await addTournamentMatch(tournamentId, {
        starts_at: startIso,
        opponent_name:
          opponentName.trim().length > 0 ? opponentName.trim() : null,
        location_name:
          locationName.trim().length > 0 ? locationName.trim() : null,
      });
      if (!res.success) {
        setError(tErrors(res.error));
        return;
      }
      setOpen(false);
      // Navega a la alineación del nuevo partido: hereda la plantilla de la
      // cabecera (T-2) y allí se distribuye el once. Su convocatoria no se
      // gestiona aparte (redirige a la cabecera).
      router.push(`/convocatorias/${res.event_id}/alineacion`);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
        <CalendarPlus className="size-4" aria-hidden />
        <span>{t('add_match')}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('add_match_title')}</DialogTitle>
            <DialogDescription>{t('add_match_description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="atm-starts">{t('field.starts_at')}</Label>
              <Input
                id="atm-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="atm-opponent">
                {t('field.opponent')}{' '}
                <span className="text-xs text-muted-foreground">
                  ({t('field.optional')})
                </span>
              </Label>
              <Input
                id="atm-opponent"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                placeholder={t('field.opponent_placeholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="atm-location">
                {t('field.location')}{' '}
                <span className="text-xs text-muted-foreground">
                  ({t('field.optional')})
                </span>
              </Label>
              <Input
                id="atm-location"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
              />
            </div>
          </div>

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
            <Button type="button" onClick={submit} disabled={pending || !startsAt}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CalendarPlus className="size-4" aria-hidden />
              )}
              <span>{t('add_match')}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
