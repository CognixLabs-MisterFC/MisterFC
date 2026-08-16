import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/locale/provider';
import {
  currentPermissionView,
  enablePushNotifications,
  type EnableErrorReason,
  type PermissionView,
} from './push-registration';

/**
 * O2-4 PR-2 — Tarjeta de ajustes de notificaciones push (perfil).
 *
 * Réplica del patrón de la web (`push-subscription-panel`): el permiso se pide
 * SOLO por acción explícita del usuario aquí, nunca al arrancar/login. Estados:
 *   - undetermined → botón "Activar notificaciones" (dispara el permiso).
 *   - granted      → confirmación de que están activadas en este dispositivo.
 *   - denied       → aviso de bloqueo que remite a los Ajustes del sistema
 *                    (sin reintento automático, como la web).
 */
export function PushSettingsCard() {
  // Push nativo = concepto propio (notificaciones.push_native); solo "denied_title"
  // se reutiliza del push web (misma frase), coherente con el namespace compartido.
  const t = useTranslations('notificaciones.push_native');
  const tShared = useTranslations('notificaciones.push');
  const [view, setView] = useState<PermissionView | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [errorReason, setErrorReason] = useState<EnableErrorReason | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const v = await currentPermissionView();
      if (active) setView(v);
    })();
    return () => {
      active = false;
    };
  }, []);

  const onEnable = useCallback(async () => {
    setBusy(true);
    setErrorReason(null);
    const res = await enablePushNotifications(supabase);
    setBusy(false);
    if (res.status === 'enabled') {
      setView('granted');
    } else if (res.status === 'denied') {
      setView(res.canAskAgain ? 'undetermined' : 'denied');
    } else {
      setErrorReason(res.reason);
    }
  }, []);

  return (
    <View className="gap-2 rounded-2xl border border-zinc-200 p-4">
      <Text className="text-base font-semibold text-[#0F1B2E]">
        {t('card_title')}
      </Text>

      {view === 'granted' ? (
        <Text className="text-sm text-emerald-600">{t('enabled')}</Text>
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
