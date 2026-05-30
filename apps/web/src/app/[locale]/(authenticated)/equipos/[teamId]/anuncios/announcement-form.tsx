'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createAnnouncement } from './actions';

type Props = {
  locale: string;
  teamId: string;
};

export function AnnouncementForm({ locale, teamId }: Props) {
  const t = useTranslations('anuncios.form');
  const tErr = useTranslations('anuncios.errors');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length === 0 || body.trim().length === 0 || pending) return;

    startTransition(async () => {
      const res = await createAnnouncement(locale, {
        team_id: teamId,
        title: title.trim(),
        body: body.trim(),
        pinned,
        expires_at: expiresAt || null,
      });
      if (res.ok) {
        setTitle('');
        setBody('');
        setPinned(false);
        setExpiresAt('');
      } else {
        const code = res.error ?? 'generic';
        setError(tErr(code));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="an-title">{t('field.title')}</Label>
        <Input
          id="an-title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="an-body">{t('field.body')}</Label>
        <Textarea
          id="an-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          required
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="size-4 rounded border-zinc-700 bg-zinc-900 text-misterfc-green focus:ring-misterfc-green"
          />
          <span>{t('field.pinned')}</span>
        </label>

        <div className="flex items-center gap-2">
          <Label htmlFor="an-expires" className="text-sm">
            {t('field.expires_at')}
          </Label>
          <Input
            id="an-expires"
            name="expires_at"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Megaphone className="size-4" aria-hidden />
          )}
          <span>{t('submit')}</span>
        </Button>
      </div>
    </form>
  );
}
