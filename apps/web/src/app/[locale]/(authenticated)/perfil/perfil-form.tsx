'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateProfile, type UpdateProfileFormState } from './actions';

type Props = {
  locale: string;
  email: string;
  initial: {
    full_name: string;
    date_of_birth: string;
    locale: string;
  };
};

export function PerfilForm({ locale, email, initial }: Props) {
  const t = useTranslations('perfil');
  const action = updateProfile.bind(null, locale);
  const [state, formAction, pending] = useActionState<
    UpdateProfileFormState,
    FormData
  >(action, {});

  const errorMessage = state.error ? t(`errors.${state.error}`) : null;
  const successMessage = state.success ? t('saved') : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="full_name">{t('field.full_name')}</Label>
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={initial.full_name}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">{t('field.email')}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          readOnly
          disabled
          className="cursor-not-allowed opacity-70"
        />
        <p className="text-xs text-muted-foreground">{t('field.email_help')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="date_of_birth">{t('field.date_of_birth')}</Label>
        <Input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          defaultValue={initial.date_of_birth}
          max={new Date().toISOString().slice(0, 10)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="locale">{t('field.locale')}</Label>
        <Select name="locale" defaultValue={initial.locale}>
          <SelectTrigger id="locale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es">{t('locales.es')}</SelectItem>
            <SelectItem value="en">{t('locales.en')}</SelectItem>
            <SelectItem value="va">{t('locales.va')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('field.locale_help')}</p>
      </div>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p className="text-sm text-misterfc-green" role="status">
          {successMessage}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{t('save')}</span>
        </Button>
      </div>
    </form>
  );
}
