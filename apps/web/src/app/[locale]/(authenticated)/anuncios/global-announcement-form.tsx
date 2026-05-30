'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createGlobalAnnouncement } from './actions';

type Team = { id: string; name: string };

type Props = {
  locale: string;
  teams: Team[];
};

export function GlobalAnnouncementForm({ locale, teams }: Props) {
  const t = useTranslations('anuncios_global.form');
  const tErr = useTranslations('anuncios_global.errors');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [clubWide, setClubWide] = useState(true);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function toggleTeam(id: string) {
    setSelectedTeams((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (title.trim().length === 0 || body.trim().length === 0 || pending) return;
    if (!clubWide && selectedTeams.length === 0) {
      setError(tErr('audience_required'));
      return;
    }

    startTransition(async () => {
      const res = await createGlobalAnnouncement(locale, {
        title: title.trim(),
        body: body.trim(),
        pinned,
        expires_at: expiresAt || null,
        audience_kind: clubWide ? 'club_wide' : 'teams',
        team_ids: clubWide ? [] : selectedTeams,
      });
      if (res.ok) {
        setOk(t('ok', { count: res.ok.created_count }));
        setTitle('');
        setBody('');
        setPinned(false);
        setExpiresAt('');
        setClubWide(true);
        setSelectedTeams([]);
      } else {
        setError(tErr(res.error ?? 'generic'));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ga-title">{t('field.title')}</Label>
        <Input
          id="ga-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ga-body">{t('field.body')}</Label>
        <Textarea
          id="ga-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={5}
          required
        />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-zinc-800 p-3">
        <legend className="px-1 text-sm font-medium">{t('field.audience')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clubWide}
            onChange={(e) => {
              setClubWide(e.target.checked);
              if (e.target.checked) setSelectedTeams([]);
            }}
            className="size-4 rounded border-zinc-700 bg-zinc-900 text-misterfc-green focus:ring-misterfc-green"
          />
          <span>{t('audience.club_wide')}</span>
        </label>

        {!clubWide && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">{t('audience.teams_hint')}</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('audience.no_teams')}
                </p>
              )}
              {teams.map((tm) => (
                <label key={tm.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedTeams.includes(tm.id)}
                    onChange={() => toggleTeam(tm.id)}
                    className="size-4 rounded border-zinc-700 bg-zinc-900 text-misterfc-green focus:ring-misterfc-green"
                  />
                  <span>{tm.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

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
          <Label htmlFor="ga-expires" className="text-sm">
            {t('field.expires_at')}
          </Label>
          <Input
            id="ga-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}
      {ok && (
        <p className="text-sm text-misterfc-green" role="status">{ok}</p>
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
