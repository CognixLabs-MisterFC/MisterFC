import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/locale/provider';
import { useSession } from '@/auth/session';
import {
  currentPermissionView,
  disablePushOnThisDevice,
  enablePushNotifications,
  type EnableErrorReason,
  type PermissionView,
} from './push-registration';
import { isPushOptedOut } from './opt-out-store';

/**
 * O2-4 PR-2 — Tarjeta de ajustes de notificaciones push (perfil).
 *
 * Réplica del patrón de la web (`push-subscription-panel`): el permiso se pide
 * SOLO por acción explícita del usuario aquí, nunca al arrancar/login. Estados:
 *   - undetermined → botón "Activar notificaciones" (dispara el permiso).
 *   - granted      → confirmación + botón de APAGAR en este dispositivo.
 *   - denied       → aviso de bloqueo que remite a los Ajustes del sistema
 *                    (sin reintento automático, como la web).
 *
 * EL INTERRUPTOR APAGA, no solo enciende. Antes, con el permiso concedido, la
 * tarjeta era un cartel: «activadas», y no había forma de dejar de recibirlas sin
 * salir a los Ajustes de Android. El permiso del sistema no se puede retirar desde
 * dentro de la app, así que apagar aquí significa lo único que está en nuestra mano
 * y lo que de verdad pide quien lo pulsa: BORRAR EL TOKEN de este dispositivo para
 * que el servidor deje de mandarle nada. Igual que el «dejar de recibir en este
 * dispositivo» de la web.
 *
 * Y se RECUERDA (`opt-out-store`): el registro silencioso corre en cada login y, con
 * el permiso todavía concedido, volvería a dar de alta el token. Sin ese recuerdo el
 * apagado duraría una sesión.
 */
export function PushSettingsCard() {
  // Push nativo = concepto propio (notificaciones.push_native); solo "denied_title"
  // se reutiliza del push web (misma frase), coherente con el namespace compartido.
  const t = useTranslations('notificaciones.push_native');
  const tShared = useTranslations('notificaciones.push');
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [view, setView] = useState<PermissionView | 'loading'>('loading');
  const [optedOut, setOptedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorReason, setErrorReason] = useState<EnableErrorReason | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const v = await currentPermissionView();
      // El apagado de ESTE dispositivo manda sobre el permiso del sistema: se puede
      // tener el permiso concedido y haber dicho que no aquí.
      const off = userId ? await isPushOptedOut(userId) : false;
      if (active) {
        setView(v);
        setOptedOut(off);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const onEnable = useCallback(async () => {
    setBusy(true);
    setErrorReason(null);
    const res = await enablePushNotifications(supabase, userId);
    setBusy(false);
    if (res.status === 'enabled') {
      setView('granted');
      setOptedOut(false);
    } else if (res.status === 'denied') {
      setView(res.canAskAgain ? 'undetermined' : 'denied');
    } else {
      setErrorReason(res.reason);
    }
  }, [userId]);

  const onDisable = useCallback(async () => {
    setBusy(true);
    setErrorReason(null);
    const res = await disablePushOnThisDevice(supabase, userId);
    setBusy(false);
    // El recuerdo ya está puesto pase lo que pase con el borrado, así que la
    // tarjeta pasa a "apagado" igual: decir lo contrario de lo que se ha guardado
    // sería peor que el propio fallo.
    setOptedOut(true);
    if (!res.ok) setErrorReason('server');
  }, [userId]);

  return (
    <View className="gap-2 rounded-2xl border border-zinc-200 p-4">
      <Text className="text-base font-semibold text-[#0F1B2E]">
        {t('card_title')}
      </Text>

      {view === 'granted' && !optedOut ? (
        <>
          <Text className="text-sm text-emerald-600">{t('enabled')}</Text>
          <Pressable
            onPress={onDisable}
            disabled={busy}
            className="mt-2 flex-row items-center justify-center gap-2 rounded-xl border border-zinc-300 py-3 active:opacity-70"
            style={busy ? { opacity: 0.6 } : undefined}
          >
            {busy ? <ActivityIndicator color="#0F1B2E" size="small" /> : null}
            <Text className="text-base font-medium text-zinc-700">
              {busy ? t('disabling') : t('disable_button')}
            </Text>
          </Pressable>
          {errorReason ? (
            <Text className="text-sm text-red-600" role="alert">
              {t('error_server')}
            </Text>
          ) : null}
        </>
      ) : view === 'granted' && optedOut ? (
        <>
          <Text className="text-sm text-zinc-500">{t('disabled_here')}</Text>
          <Pressable
            onPress={onEnable}
            disabled={busy}
            className="mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-[#0F1B2E] py-3 active:opacity-70"
            style={busy ? { opacity: 0.6 } : undefined}
          >
            {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text className="text-base font-medium text-white">
              {busy ? t('enabling') : t('enable_button')}
            </Text>
          </Pressable>
        </>
      ) : view === 'denied' ? (
        <>
          <Text className="text-sm font-medium text-zinc-700">
            {tShared('denied_title')}
          </Text>
          <Text className="text-sm text-zinc-500">{t('denied_body')}</Text>
        </>
      ) : (
        <>
          <Text className="text-sm text-zinc-500">{t('card_body')}</Text>
          <Pressable
            onPress={onEnable}
            disabled={busy || view === 'loading'}
            className="mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-[#0F1B2E] py-3 active:opacity-70"
            style={busy || view === 'loading' ? { opacity: 0.6 } : undefined}
          >
            {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text className="text-base font-medium text-white">
              {busy ? t('enabling') : t('enable_button')}
            </Text>
          </Pressable>
          {errorReason ? (
            <Text className="text-sm text-red-600" role="alert">
              {t(errorReason === 'server' ? 'error_server' : 'error_device')}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
