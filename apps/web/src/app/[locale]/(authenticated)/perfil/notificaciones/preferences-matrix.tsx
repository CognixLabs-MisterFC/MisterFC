'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { updateNotificationPreference } from './actions';

type Props = {
  locale: string;
  initial: Record<string, boolean>;
  types: string[];
  channels: string[];
};

const SWITCH_DISABLED_TYPES = new Set<string>([]);

/**
 * F5.6 — matriz tipo × canal. Cada switch persiste vía server action
 * con optimistic UI. Revert on error.
 *
 *   - canal `in_app`: switch deshabilitado en ON (no opt-out: la campana
 *     siempre se llena, es el fallback si no hay push).
 *   - canal `email`: visible pero deshabilitado con tooltip — disponible
 *     cuando F16 SMTP esté listo.
 *   - canal `push`: editable. Si el user no está suscrito en este
 *     dispositivo, el switch no tiene efecto hasta que se suscriba (la
 *     preferencia se respeta en cualquier dispositivo suyo cuando llegue).
 */
export function PreferencesMatrix({ locale, initial, types, channels }: Props) {
  const t = useTranslations('notificaciones.preferences');
  const tType = useTranslations('notificaciones.types');
  const tChannel = useTranslations('notificaciones.channels');
  const [values, setValues] = useState<Record<string, boolean>>(initial);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function onToggle(type: string, channel: string, next: boolean) {
    const key = `${type}:${channel}`;
    if (channel === 'in_app') return; // no opt-out
    if (channel === 'email') return; // bloqueado hasta F16

    const prev = values[key] ?? true;
    setValues((v) => ({ ...v, [key]: next }));
    setErrorKey(null);

    startTransition(async () => {
      const res = await updateNotificationPreference(locale, {
        type,
        channel,
        enabled: next,
      });
      if (!res.ok) {
        setValues((v) => ({ ...v, [key]: prev }));
        setErrorKey(key);
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-separate border-spacing-y-1">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left">{t('column_type')}</th>
            {channels.map((c) => (
              <th key={c} className="px-2 text-center">
                <span>{tChannel(c)}</span>
                {c === 'email' && (
                  <p className="text-[10px] normal-case opacity-70">
                    {t('email_disabled_hint')}
                  </p>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type} className="text-sm">
              <td className="py-2 pr-2">
                <span className="font-medium">{tType(`${type}.label`)}</span>
                <p className="text-xs text-muted-foreground">
                  {tType(`${type}.description`)}
                </p>
              </td>
              {channels.map((channel) => {
                const key = `${type}:${channel}`;
                const checked = values[key] ?? true;
                const disabled =
                  channel === 'in_app' ||
                  channel === 'email' ||
                  SWITCH_DISABLED_TYPES.has(type);
                const isErrored = errorKey === key;
                return (
                  <td key={channel} className="px-2 text-center">
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={channel === 'in_app' ? true : checked}
                        disabled={disabled}
                        onCheckedChange={(v) => onToggle(type, channel, v)}
                        aria-label={`${tType(`${type}.label`)} · ${tChannel(channel)}`}
                      />
                      {isErrored && (
                        <Loader2 className="ml-1 size-3 text-destructive" />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {pending && (
        <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden /> {t('saving')}
        </p>
      )}
    </div>
  );
}
