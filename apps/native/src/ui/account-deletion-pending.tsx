import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { useTranslations } from '@/locale/provider';

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha límite como DD/MM/AAAA, determinista y sin depender del idioma del dispositivo. */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * BC-5 — pantalla terminal del borrado EN CURSO. La pinta el gatekeeper
 * (`app/index.tsx`) en lugar de "sin acceso" cuando `useApp().accountDeletion` no es
 * null: quien pide el borrado se queda sin clubes y cae justo ahí.
 *
 * Va ANTES que el banner de baja, y no es un detalle de estilo: pedir el borrado pone
 * `left_at` en todas las memberships, así que `removedMemberships` TAMBIÉN trae filas y
 * el usuario leería que le ha dado de baja el club —falso— sin ver el botón de cancelar.
 *
 * Cancelar se admite en cualquier momento hasta que el job remate el borrado (decisión
 * de Jose: sin ventana más corta). Sin conexión el botón se deshabilita: es una
 * escritura, y el write-guard de la app no deja escribir offline.
 */
export function AccountDeletionPendingScreen() {
  const { accountDeletion, reload, signOut } = useApp();
  const t = useTranslations('account_deletion');
  const tShell = useTranslations('shell');
  const online = useIsOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accountDeletion) return null;

  const onCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await callServerEndpoint('/api/account/deletion/cancel');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const code = body.error ?? 'generic';
        setError(
          code === 'not_pending' || code === 'admin_slot_taken'
            ? t(`errors.${code}`)
            : t('errors.generic'),
        );
        return;
      }
      // Recargar el contexto es lo que devuelve al usuario a su app: al desaparecer el
      // borrado y volver sus memberships, el gatekeeper reencamina solo. NO se cierra
      // sesión: arrepentirse es volver a tu cuenta, no salir de ella.
      await reload();
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-4 p-6">
        <View className="gap-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <Text className="text-base font-semibold text-red-900">{t('pending_title')}</Text>
          <Text className="mt-1 text-sm text-red-800">
            {t('pending_body', { date: formatDeadline(accountDeletion.deadlineAt) })}
          </Text>
          {accountDeletion.pendingPlayers > 0 ? (
            <Text className="mt-2 text-xs text-red-800">
              {t('pending_players', { count: accountDeletion.pendingPlayers })}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onCancel}
          disabled={busy || !online}
          className="items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
          style={busy || !online ? { opacity: 0.5 } : undefined}
        >
          {busy ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-base font-medium text-zinc-700">{t('cancel_deletion')}</Text>
          )}
        </Pressable>

        {!online ? (
          <Text className="text-center text-xs text-amber-600">{t('offline')}</Text>
        ) : null}
        {error ? <Text className="text-center text-sm text-red-600">{error}</Text> : null}

        <Pressable
          onPress={signOut}
          className="mt-2 items-center rounded-xl py-3 active:opacity-70"
        >
          <Text className="text-base font-medium text-zinc-500">{tShell('signout')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
