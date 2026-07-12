'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  createSupabaseBrowserClient,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { ClubLogo } from '@/components/ui/club-logo';
import { clubLogoUrl } from '@/lib/club-logo';
import { setClubLogo } from './actions';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * F14B-9a — Sube/cambia/quita el logo del club. Reutiliza el patrón de
 * player-photo-uploader: sube al bucket `club-logos` (path {club_id}/{uuid}.{ext},
 * la policy exige admin_club) y persiste el path vía set_club_logo. Bucket público
 * → preview con URL pública, sin firmar. Solo se renderiza para admin_club.
 */
export function ClubLogoUploader({
  clubId,
  clubName,
  initialPath,
}: {
  clubId: string;
  clubName: string;
  initialPath: string | null;
}) {
  const t = useTranslations('ajustes');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [path, setPath] = useState<string | null>(initialPath);
  const [error, setError] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError(t('logo.error_mime'));
      e.target.value = '';
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(t('logo.error_too_large'));
      e.target.value = '';
      return;
    }

    const ext = MIME_TO_EXT[file.type] ?? 'png';
    const objectPath = `${clubId}/${crypto.randomUUID()}.${ext}`;

    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from('club-logos')
        .upload(objectPath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) {
        setError(t('logo.error_upload'));
        return;
      }
      const result = await setClubLogo(clubId, objectPath);
      if (!result.success) {
        setError(result.error === 'forbidden' ? t('logo.error_forbidden') : t('logo.error_upload'));
        return;
      }
      setPath(objectPath);
    });

    e.target.value = '';
  }

  function onRemove() {
    startTransition(async () => {
      const result = await setClubLogo(clubId, null);
      if (!result.success) {
        setError(t('logo.error_upload'));
        return;
      }
      setPath(null);
    });
  }

  // Preview: URL pública inmediata (bucket público). key fuerza recarga tras cambio.
  const previewUrl = clubLogoUrl(path);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={path ?? 'none'}
            src={previewUrl}
            alt=""
            className="size-20 rounded object-cover"
          />
        ) : (
          <ClubLogo path={null} name={clubName} className="size-20 text-2xl" />
        )}

        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_MIME_TYPES.join(',')}
            className="hidden"
            onChange={onFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            <span>{path ? t('logo.change') : t('logo.upload')}</span>
          </Button>
          {path && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={pending}
            >
              <Trash2 className="size-4" aria-hidden />
              <span>{t('logo.remove')}</span>
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('logo.hint', { maxMb: AVATAR_MAX_BYTES / 1024 / 1024 })}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
