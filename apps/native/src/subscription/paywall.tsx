import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { useTranslations } from '@/locale/provider';
import { DeleteAccountCard } from '@/ui/delete-account-card';
import {
  canPurchase,
  loadOffering,
  purchasePackage,
  restorePurchases,
} from '@/subscription/purchases';
import { useSubscription } from '@/subscription/provider';

/**
 * SU-4 — el MURO. Decisión 3 de Jose: sin suscripción activa no se ve nada, pantalla de
 * suscripción y punto. Ni lectura parcial ni periodo de prueba.
 *
 * Pero lleva DENTRO la tarjeta de borrar la cuenta, y eso no es un adorno: Apple
 * Guideline 5.1.1(v) exige poder iniciar el borrado desde dentro de la app, y toda la
 * serie BC existe para cumplirlo. Un muro que tapara también el borrado rompería lo que
 * BC acaba de arreglar y volvería a bloquear la publicación. Así que "no se ve nada"
 * significa nada del producto — salir y borrarse siguen estando.
 *
 * Cobrar solo desde el móvil (decisión 6): no hay pasarela web y no se va a montar.
 */
export function PaywallScreen() {
  const t = useTranslations('subscription');
  const tShell = useTranslations('shell');
  const { signOut } = useApp();
  const { status, error, refresh, waitForEntitlement } = useSubscription();
  const online = useIsOnline();

  // `undefined` = todavía no se ha pedido; `null` = no hay paquete que vender. Se
  // DERIVA el "cargando" en vez de guardarlo: así el efecto no hace ningún setState
  // sincrónico (el lint del compilador de React lo rechaza, y con razón).
  const [pkg, setPkg] = useState<PurchasesPackage | null | undefined>(undefined);
  const [busy, setBusy] = useState<'buy' | 'restore' | 'activating' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sellable = canPurchase();
  const loadingOffer = sellable && pkg === undefined;

  useEffect(() => {
    if (!sellable) return;
    let alive = true;
    void (async () => {
      const res = await loadOffering();
      if (!alive) return;
      if (res.ok) {
        setPkg(res.annual);
      } else {
        setPkg(null);
        setMessage(t('errors.offering'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [sellable, t]);

  const onBuy = async () => {
    if (!pkg) return;
    setMessage(null);
    setBusy('buy');
    const res = await purchasePackage(pkg);
    if (!res.ok) {
      setBusy(null);
      // Cerrar la hoja de pago no es un error: no se le dice nada.
      if (!res.cancelled) setMessage(t('errors.purchase'));
      return;
    }
    await activate();
  };

  const onRestore = async () => {
    setMessage(null);
    setBusy('restore');
    const res = await restorePurchases();
    if (!res.ok) {
      setBusy(null);
      setMessage(t('errors.restore'));
      return;
    }
    if (!res.entitled) {
      setBusy(null);
      setMessage(t('restore_none'));
      return;
    }
    await activate();
  };

  /**
   * Quien abre la puerta es el SERVIDOR, no el SDK. Tras pagar hay que esperar a que el
   * webhook llegue, así que se reintenta unos segundos con un mensaje honesto en
   * pantalla. Si no llega, NO se abre nada: se dice que puede tardar y se deja
   * "restaurar compras" a mano.
   */
  const activate = async () => {
    setBusy('activating');
    const ok = await waitForEntitlement();
    setBusy(null);
    if (!ok) setMessage(t('activating_slow'));
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerClassName="gap-4 p-6">
        <Text className="text-2xl font-bold text-[#0F1B2E]">{t('title')}</Text>
        <Text className="text-base text-zinc-600">{t('body')}</Text>

        {/* Un impago dentro de la gracia NO llega aquí (tiene acceso). Si se ve este
            aviso es que la gracia ya venció: se le dice por qué está fuera. */}
        {status?.billingIssue ? (
          <View className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Text className="text-sm text-amber-900">{t('billing_issue')}</Text>
          </View>
        ) : null}

        {error ? (
          <View className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Text className="text-sm text-zinc-700">{t('errors.status')}</Text>
            <Pressable onPress={refresh} className="mt-2 active:opacity-70">
              <Text className="text-sm font-medium text-[#438832]">{t('retry')}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Android todavía no puede cobrar: se dice, no se ofrece un botón muerto. */}
        {!sellable ? (
          <View className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Text className="text-sm text-zinc-700">{t('unavailable_platform')}</Text>
          </View>
        ) : loadingOffer ? (
          <ActivityIndicator />
        ) : pkg ? (
          <>
            <View className="rounded-xl border border-zinc-200 px-4 py-4">
              <Text className="text-lg font-semibold text-[#0F1B2E]">
                {pkg.product.title}
              </Text>
              <Text className="mt-1 text-2xl font-bold text-[#438832]">
                {pkg.product.priceString}
              </Text>
              <Text className="mt-1 text-xs text-zinc-500">{t('per_year')}</Text>
            </View>

            <Pressable
              onPress={onBuy}
              disabled={busy !== null || !online}
              className="items-center rounded-xl bg-[#438832] py-4 active:opacity-70"
              style={busy !== null || !online ? { opacity: 0.5 } : undefined}
            >
              {busy === 'buy' || busy === 'activating' ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className="text-base font-semibold text-white">{t('subscribe')}</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onRestore}
              disabled={busy !== null || !online}
              className="items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
              style={busy !== null || !online ? { opacity: 0.5 } : undefined}
            >
              {busy === 'restore' ? (
                <ActivityIndicator />
              ) : (
                <Text className="text-base font-medium text-zinc-700">{t('restore')}</Text>
              )}
            </Pressable>
          </>
        ) : (
          <View className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Text className="text-sm text-zinc-700">{t('errors.offering')}</Text>
          </View>
        )}

        {busy === 'activating' ? (
          <Text className="text-center text-xs text-zinc-500">{t('activating')}</Text>
        ) : null}
        {!online ? (
          <Text className="text-center text-xs text-amber-600">{t('offline')}</Text>
        ) : null}
        {message ? (
          <Text className="text-center text-sm text-zinc-700">{message}</Text>
        ) : null}

        <Text className="mt-2 text-xs text-zinc-400">{t('terms_note')}</Text>

        {/* Apple 5.1.1(v): el borrado tiene que seguir alcanzable DESDE el muro. */}
        <View className="mt-6 border-t border-zinc-100 pt-6">
          <DeleteAccountCard />
        </View>

        <Pressable onPress={signOut} className="mt-2 items-center py-3 active:opacity-70">
          <Text className="text-base font-medium text-zinc-500">{tShell('signout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
