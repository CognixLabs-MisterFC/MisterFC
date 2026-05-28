'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  avatarUploadSchema,
  createSupabaseBrowserClient,
} from '@misterfc/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { clearAvatarPath, updateAvatarPath } from './actions';

type Props = {
  userId: string;
  initialPath: string | null;
  initialSignedUrl: string | null;
  fallback: string;
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function uuid(): string {
  return crypto.randomUUID();
}

export function AvatarUploader({
  userId,
  initialPath,
  initialSignedUrl,
  fallback,
}: Props) {
  const t = useTranslations('perfil');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialSignedUrl);
  const [hasAvatar, setHasAvatar] = useState<boolean>(Boolean(initialPath));
  const [error, setError] = useState<string | null>(null);

  function onPick() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = avatarUploadSchema.safeParse({
      mimeType: file.type,
      size: file.size,
    });
    if (!validation.success) {
      const code = validation.error.issues[0]?.message ?? 'avatar_mime_invalid';
      setError(t(`errors.${code}`));
      e.target.value = '';
      return;
    }

    const ext = MIME_TO_EXT[file.type] ?? 'jpg';
    const path = `${userId}/${uuid()}.${ext}`;

    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from('profile-avatars')
        .upload(path, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) {
        setError(t('errors.avatar_upload_failed'));
        return;
      }

      const result = await updateAvatarPath(path);
      if (!result.success) {
        setError(t('errors.avatar_upload_failed'));
        return;
      }

      // Render local: signed URL inmediata para preview tras upload.
      const { data: signed } = await supabase.storage
        .from('profile-avatars')
        .createSignedUrl(path, 3600);
      setPreviewUrl(signed?.signedUrl ?? null);
      setHasAvatar(true);
    });

    e.target.value = '';
  }

  function onRemove() {
    startTransition(async () => {
      const result = await clearAvatarPath();
      if (!result.success) {
        setError(t('errors.avatar_remove_failed'));
        return;
      }
      setPreviewUrl(null);
      setHasAvatar(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Avatar className="size-20">
        {previewUrl && <AvatarImage src={previewUrl} alt="" />}
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2 sm:flex-1">
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          className="hidden"
          onChange={onFile}
          aria-label={t('avatar.pick_label')}
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
            <span>{t('avatar.change')}</span>
          </Button>
          {hasAvatar && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={pending}
            >
              <Trash2 className="size-4" aria-hidden />
              <span>{t('avatar.remove')}</span>
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {t('avatar.hint', { maxMb: AVATAR_MAX_BYTES / 1024 / 1024 })}
        </p>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
