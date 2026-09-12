import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  previewAccountDeletionFromClient,
  type AccountDeletionBlocker,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { useTranslations } from '@/locale/provider';
import { logOutPurchases } from '@/subscription/purchases';

/**
 * BC-5 — "Eliminar mi cuenta" (Apple Guideline 5.1.1 v). Vive en Perfil, la pantalla
 * COMPARTIDA por todas las áreas, así que la ve cualquier rol sin duplicar nada.
 *
 * El camino que se graba para Apple es el rápido (sin bloqueantes):
 *   pulsar → confirmar escribiendo la palabra → el servidor anonimiza →
 *   sesión cerrada → "cuenta eliminada" → no se puede volver a entrar.
 *
 * El preview se pide al ABRIR el diálogo, no al montar la pantalla: es una consulta que
 * solo importa a quien va a borrarse, y Perfil lo abre todo el mundo cada dos por tres.
 * Si el preview falla NO se sigue: prometer "no se pedirá la supresión de nadie" cuando
 * no lo sabemos sería mentir sobre el alcance de algo irreversible.
 */
export function DeleteAccountCard() {
  const t = useTranslations('account_deletion');
  const { reload, signOut } = useApp();
  const online = useIsOnline();

  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [blockers, setBlockers] = useState<AccountDeletionBlocker[] | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmWord = t('confirm_word');
  const canConfirm = typed.trim().toLowerCase() === confirmWord.toLowerCase() && !busy;

  // SU-4 — aviso que exige Apple: borrar la cuenta NO cancela la suscripción. La clave
  // estuvo VACÍA desde BC-4 a propósito (no había suscripción y no se iba a afirmar algo
  // falso) y se rellenó al entrar la suscripción. El `.trim()` se queda: vacía ⇒ el
  // aviso no se pinta, y hay un test en core que exige que NO vuelva a quedarse vacía,
  // porque un texto que desaparece en silencio es justo lo que no se nota.
  const subscriptionNote = t('subscription_note').trim();

  const openDialog = async () => {
    setError(null);
    setTyped('');
    setBlockers(null);
    setLoadingPreview(true);
    setOpen(true);
    const res = await previewAccountDeletionFromClient(supabase);
    setLoadingPreview(false);
    if (!res.ok) {
      setError(t('errors.generic'));
      setOpen(false);
      return;
    }
    setBlockers(res.blockers);
  };

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await callServerEndpoint('/api/account/deletion/request');
      if (!res.ok) {
        setError(t('errors.generic'));
        return;
      }
      const body = (await res.json()) as {
        completed?: boolean;
        blockingPlayers?: number;
        warning?: string;
      };
      setOpen(false);

      // ¿Se llegó a anonimizar la cuenta? `completed` lo dice cuando todo salió bien.
      // Pero el servidor también devuelve `completed: false` con `warning:
      // 'auth_neutralize_failed'`: ahí la anonimización SÍ se aplicó (nombre, foto,
      // teléfono, vínculos… ya no están) y lo único que quedó a medias fue neutralizar
      // las credenciales en GoTrue, que BC-6 repescará. Mandar a esa persona a "sin
      // acceso" sería peor y además falso: sus datos ya no existen. Con
      // `warning: 'rpc_failed'` es al revés —no se tocó nada— y sí toca la pantalla de
      // borrado en curso, que el cron rematará.
      const anonymized = body.completed === true || body.warning === 'auth_neutralize_failed';

      if (anonymized) {
        // Camino rápido: la cuenta ya está anonimizada.
        //
        // ORDEN IMPORTANTE: primero se NAVEGA y después se cierra sesión. Al revés hay
        // carrera: `signOut` deja `user` en null y el SessionGuard, viendo todavía la
        // ruta de Perfil (que no es pública), rebota al login — y el revisor de Apple no
        // llega a ver la pantalla de "cuenta eliminada", que es justo el plano que
        // demuestra el borrado. Navegando antes, el guard ya encuentra una ruta pública.
        router.replace('/cuenta-eliminada');
        // SU-4 · ADR-0022 §4b — el SDK de RevenueCat TAMBIÉN tiene que cerrar sesión, y
        // va aquí y no en otro sitio: es el único camino por el que una cuenta se
        // anonimiza desde la app. Sin esto el SDK conserva cacheado el App User ID de la
        // cuenta borrada en ESTE dispositivo, y el siguiente "restaurar compras" vuelve
        // a asociar la compra al perfil anonimizado. El agujero está en nuestra app, no
        // en su capa, y no lo tapa ninguna de las otras tres piezas del antídoto.
        //
        // Antes del `signOut` de Supabase a propósito: `signOut` desmonta esta pantalla,
        // y un `await` posterior podría no llegar a ejecutarse. Nunca lanza.
        await logOutPurchases();
        await signOut();
        return;
      }
      // Con bloqueantes NO se cierra sesión: sin ella, la pantalla de estado y el botón
      // de cancelar serían inalcanzables. Se recarga el contexto para que el gatekeeper
      // vea el borrado en curso y pinte la pantalla terminal en vez de "sin acceso".
      await reload();
      router.replace('/');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-2 rounded-2xl border border-red-200 bg-white p-4">
      <Text className="mb-2 text-sm font-semibold text-red-700">{t('card_title')}</Text>
      <Text className="mb-3 text-xs text-zinc-500">{t('card_hint')}</Text>

      <Pressable
        onPress={openDialog}
        disabled={!online}
        className="items-center rounded-xl border border-red-300 py-3 active:opacity-70"
        style={!online ? { opacity: 0.5 } : undefined}
      >
        <Text className="text-sm font-medium text-red-700">{t('button')}</Text>
      </Pressable>

      {!online ? (
        <Text className="mt-2 text-xs text-amber-600">{t('offline')}</Text>
      ) : null}
      {error && !open ? <Text className="mt-2 text-xs text-red-600">{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-center bg-black/50 p-6">
          <View className="max-h-[85%] rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">{t('dialog_title')}</Text>

            {loadingPreview ? (
              <View className="py-8">
                <ActivityIndicator />
              </View>
            ) : (
              <>
                <Text className="mt-2 text-sm text-zinc-600">{t('dialog_intro')}</Text>

                <Text className="mt-3 text-sm font-semibold text-zinc-800">
                  {t('removed_title')}
                </Text>
                <Text className="text-xs text-zinc-600">{t('removed_body')}</Text>

                <Text className="mt-3 text-sm font-semibold text-zinc-800">
                  {t('kept_title')}
                </Text>
                <Text className="text-xs text-zinc-600">{t('kept_body')}</Text>

                {blockers && blockers.length > 0 ? (
                  <View className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                    <Text className="text-xs font-semibold text-amber-900">
                      {t('blockers_title')}
                    </Text>
                    {blockers.map((b) => (
                      <Text key={b.playerId} className="mt-1 text-xs text-amber-900">
                        · {b.playerName} · {b.clubName}
                      </Text>
                    ))}
                    <Text className="mt-2 text-xs text-amber-900">{t('blockers_body')}</Text>
                  </View>
                ) : null}

                {subscriptionNote.length > 0 ? (
                  <Text className="mt-3 text-xs text-zinc-500">{subscriptionNote}</Text>
                ) : null}

                <Text className="mt-3 text-xs text-zinc-500">
                  {t('confirm_label', { word: confirmWord })}
                </Text>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800"
                />

                {error ? <Text className="mt-2 text-xs text-red-600">{error}</Text> : null}

                <View className="mt-4 flex-row justify-end gap-3">
                  <Pressable onPress={() => setOpen(false)} disabled={busy} className="px-3 py-2">
                    <Text className="text-sm text-zinc-500">{t('cancel')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={onConfirm}
                    disabled={!canConfirm}
                    className="rounded-xl bg-red-600 px-4 py-2 active:opacity-80"
                    style={!canConfirm ? { opacity: 0.5 } : undefined}
                  >
                    {busy ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text className="text-sm font-semibold text-white">{t('confirm')}</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
