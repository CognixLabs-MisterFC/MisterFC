'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import {
  PLAYER_PHOTO_MAX_BYTES,
  PLAYER_PHOTO_MIME_TYPES,
  createSupabaseBrowserClient,
  playerPhotoUploadSchema,
} from '@misterfc/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  clearPlayerPhotoPath,
  updatePlayerPhotoPath,
} from '../actions';

const SIGNED_URL_TTL_SECONDS = 600; // 10 min

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type Labels = {
  change: string;
  remove: string;
  hint: string;
  errors: {
    mime: string;
    too_large: string;
    empty: string;
    upload_failed: string;
    remove_failed: string;
  };
};

type Props = {
  playerId: string;
  initialPath: string | null;
  initialSignedUrl: string | null;
  fallback: string;
  canManage: boolean;
  labels: Labels;
};

function uuid(): string {
  return crypto.randomUUID();
}

export function PlayerPhotoUploader({
  playerId,
  initialPath,
  initialSignedUrl,
  fallback,
  canManage,
  labels,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialSignedUrl);
  const [hasPhoto, setHasPhoto] = useState<boolean>(Boolean(initialPath));
  const [error, setError] = useState<string | null>(null);

  function mapMessage(code: string | undefined): string {
    if (code === 'player_photo_mime_invalid') return labels.errors.mime;
    if (code === 'player_photo_too_large') return labels.errors.too_large;
    if (code === 'player_photo_empty') return labels.errors.empty;
    return labels.errors.upload_failed;
  }

  function onPick() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = playerPhotoUploadSchema.safeParse({
      mimeType: file.type,
      size: file.size,
    });
    if (!validation.success) {
      setError(mapMessage(validation.error.issues[0]?.message));
      e.target.value = '';
      return;
    }

    const ext = MIME_TO_EXT[file.type] ?? 'jpg';
    const path = `${playerId}/${uuid()}.${ext}`;

    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from('player-photos')
        .upload(path, file, {
          cacheControl: '600',
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) {
        setError(labels.errors.upload_failed);
        return;
      }

      const result = await updatePlayerPhotoPath(playerId, path);
      if (!result.success) {
        setError(labels.errors.upload_failed);
        return;
      }

      const { data: signed } = await supabase.storage
        .from('player-photos')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      setPreviewUrl(signed?.signedUrl ?? null);
      setHasPhoto(true);
    });

    e.target.value = '';
  }

  function onRemove() {
    startTransition(async () => {
      const result = await clearPlayerPhotoPath(playerId);
      if (!result.success) {
        setError(labels.errors.remove_failed);
        return;
      }
      setPreviewUrl(null);
      setHasPhoto(false);
    });
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Avatar className="size-24">
        {previewUrl && <AvatarImage src={previewUrl} alt="" />}
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>

      {canManage && (
        <div className="flex flex-col items-start gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={PLAYER_PHOTO_MIME_TYPES.join(',')}
            className="hidden"
            onChange={onFile}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPick}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="size-4" aria-hidden />
              )}
              <span>{labels.change}</span>
            </Button>
            {hasPhoto && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                disabled={pending}
              >
                <Trash2 className="size-4" aria-hidden />
                <span>{labels.remove}</span>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {labels.hint.replace(
              '{maxMb}',
              String(PLAYER_PHOTO_MAX_BYTES / 1024 / 1024)
            )}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
