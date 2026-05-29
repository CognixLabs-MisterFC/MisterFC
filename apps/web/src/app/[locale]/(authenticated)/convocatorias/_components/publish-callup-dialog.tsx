'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Megaphone } from 'lucide-react';
import { TRANSPORT_MODES, type TransportMode } from '@misterfc/core';
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
import { publishCallup, type PublishCallupState } from '../actions';

type Props = {
  eventId: string;
  /** Si ya existe meta, prefill inicial. */
  initial: {
    meeting_at: string | null;
    meeting_location: string | null;
    meeting_address: string | null;
    transport_mode: TransportMode | null;
    transport_notes: string | null;
    notes_general: string | null;
    published: boolean;
  };
};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  // Convertir a datetime-local (sin segundos). Usa el tz del browser pero
  // como el server lo guarda en UTC vía new Date(), el viaje round-trip
  // es coherente.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishCallupDialog({ eventId, initial }: Props) {
  const t = useTranslations('convocatorias.publish');
  const tTransport = useTranslations('convocatorias.transport');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PublishCallupState>({});

  const [meetingAt, setMeetingAt] = useState(
    toLocalInputValue(initial.meeting_at)
  );
  const [meetingLocation, setMeetingLocation] = useState(
    initial.meeting_location ?? ''
  );
  const [meetingAddress, setMeetingAddress] = useState(
    initial.meeting_address ?? ''
  );
  const [transportMode, setTransportMode] = useState<TransportMode | ''>(
    initial.transport_mode ?? ''
  );
  const [transportNotes, setTransportNotes] = useState(
    initial.transport_notes ?? ''
  );
  const [notesGeneral, setNotesGeneral] = useState(
    initial.notes_general ?? ''
  );

  function submit(publish: boolean) {
    startTransition(async () => {
      const isoMeeting = meetingAt
        ? new Date(meetingAt).toISOString()
        : '';
      const r = await publishCallup({
        event_id: eventId,
        meeting_at: isoMeeting,
        meeting_location: meetingLocation,
        meeting_address: meetingAddress || null,
        transport_mode: transportMode || null,
        transport_notes: transportNotes || null,
        notes_general: notesGeneral || null,
        publish,
      });
      setState(r);
      if (r.success) setOpen(false);
    });
  }

  const errorMsg = state.error
    ? t(`errors.${state.error}` as 'errors.generic')
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={initial.published ? 'outline' : 'default'} size="sm">
          <Megaphone className="size-4" aria-hidden />
          <span>
            {initial.published ? t('action_edit') : t('action_publish')}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial.published ? t('title_edit') : t('title_publish')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(true);
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="pc-meeting-at">{t('field.meeting_at')}</Label>
            <Input
              id="pc-meeting-at"
              type="datetime-local"
              value={meetingAt}
              onChange={(e) => setMeetingAt(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pc-loc">{t('field.meeting_location')}</Label>
            <Input
              id="pc-loc"
              value={meetingLocation}
              onChange={(e) => setMeetingLocation(e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pc-addr">{t('field.meeting_address')}</Label>
            <Input
              id="pc-addr"
              value={meetingAddress}
              onChange={(e) => setMeetingAddress(e.target.value)}
              maxLength={300}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pc-tm">{t('field.transport_mode')}</Label>
              <Select
                value={transportMode}
                onValueChange={(v) => setTransportMode(v as TransportMode)}
              >
                <SelectTrigger id="pc-tm">
                  <SelectValue placeholder={t('field.optional')} />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tTransport(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pc-tn">{t('field.transport_notes')}</Label>
              <Input
                id="pc-tn"
                value={transportNotes}
                onChange={(e) => setTransportNotes(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pc-notes">{t('field.notes_general')}</Label>
            <textarea
              id="pc-notes"
              value={notesGeneral}
              onChange={(e) => setNotesGeneral(e.target.value)}
              maxLength={1000}
              rows={3}
              className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => submit(false)}
              disabled={pending}
            >
              {t('save_draft')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              <span>
                {initial.published ? t('save_changes') : t('publish_now')}
              </span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
