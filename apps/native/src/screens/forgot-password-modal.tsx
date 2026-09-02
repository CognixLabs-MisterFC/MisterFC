import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { forgotPasswordSchema } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { webBaseUrl } from '@/lib/server-api';
import { appLocale, useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * RECUPERAR CONTRASEÑA desde el login de la app.
 *
 * Copia el patrón YA PROBADO del perfil (`profile-screen.tsx` → AccountCard):
 * `resetPasswordForEmail` con `redirectTo` a la WEB
 * (`/auth/callback?next=/{locale}/reset-password`). La app NO recibe el enlace del
 * correo: no hay deep links (esquema `misterfc://` declarado, pero sin
 * intentFilters de Android ni associatedDomains de iOS), así que el aterrizaje es
 * la web, EXACTAMENTE igual que con el enlace de invitación. Aquí solo se dispara
 * el envío; el formulario de contraseña nueva es el de web, que ya existe y no se
 * toca.
 *
 * NO REVELAR SI EL EMAIL EXISTE (lo más importante de esta pantalla): Supabase
 * devuelve éxito tanto si la cuenta existe como si no, y aquí NO se comprueba nada
 * antes de enviar. La confirmación es SIEMPRE la misma —"si existe una cuenta
 * asociada a …"—, igual que en la web. Un error solo se enseña cuando el envío
 * falla de verdad (p. ej. el límite de correos), nunca "ese email no existe".
 *
 * Es un modal y no una ruta propia A PROPÓSITO: `SessionGuard` devuelve al login a
 * cualquier ruta sin sesión que no sea `/login`, así que una pantalla aparte
 * obligaría a tocar el guard GLOBAL de sesión. Mismo resultado para el usuario,
 * sin meter mano en la navegación de auth.
 *
 * CASO CONOCIDO, NO TRATADO (decisión: no tocar el flujo de invitación): una cuenta
 * con `invite_pending` que recupera contraseña se queda con contraseña pero sin
 * membership, y su invitación sigue pidiéndole nombre+contraseña al aceptar. No
 * abre ningún agujero (hay que controlar el buzón) y arreglarlo pasa por el flujo
 * de invitación, recién estabilizado.
 */
export function ForgotPasswordModal({
  visible,
  onClose,
  initialEmail,
}: {
  visible: boolean;
  onClose: () => void;
  initialEmail?: string;
}) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<'invalid_email' | 'generic' | null>(null);

  function close() {
    if (sending) return;
    setSent(false);
    setError(null);
    onClose();
  }

  async function submit() {
    if (sending) return;
    setError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError('invalid_email');
      return;
    }

    // Sin dominio web configurado no se envía: el enlace del correo aterrizaría
    // donde decidiera el proyecto, no donde sabemos. El acceso ya está oculto en
    // el login en ese caso; esto es el cinturón.
    const base = webBaseUrl();
    if (!base) {
      setError('generic');
      return;
    }

    setSending(true);
    try {
      const next = `/${appLocale()}/reset-password`;
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo: `${base}/auth/callback?next=${encodeURIComponent(next)}` },
      );
      // OJO: `sendError` NO distingue "cuenta inexistente" (Supabase responde OK en
      // ese caso); solo cubre fallos reales de envío. No se filtra nada.
      if (sendError) setError('generic');
      else setSent(true);
    } catch {
      setError('generic');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-md rounded-2xl bg-white p-5">
          {sent ? (
            <>
              <Text className="text-lg font-bold text-[#0F1B2E]">
                {t('check_email.reset.title')}
              </Text>
              <Text className="mt-2 text-sm text-zinc-500">
                {t('check_email.reset.body', { email: email.trim() })}
              </Text>
              <Pressable
                onPress={close}
                style={{ backgroundColor: BRAND.green }}
                className="mt-5 rounded-xl py-3 active:opacity-80"
              >
                <Text className="text-center text-sm font-semibold text-emerald-950">
                  {t('check_email.back_to_signin')}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-lg font-bold text-[#0F1B2E]">
                {t('forgot_password.title')}
              </Text>
              <Text className="mt-1 text-sm text-zinc-500">
                {t('forgot_password.subtitle')}
              </Text>

              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('forgot_password.email_placeholder')}
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                inputMode="email"
                editable={!sending}
                onSubmitEditing={submit}
                className="mt-4 rounded-xl border border-zinc-200 px-4 py-3 text-base text-[#0F1B2E]"
              />

              {error ? (
                <Text className="mt-2 text-sm text-red-600">
                  {t(`forgot_password.error_${error}`)}
                </Text>
              ) : null}

              <Pressable
                onPress={submit}
                disabled={sending}
                style={{ backgroundColor: BRAND.green }}
                className="mt-4 flex-row items-center justify-center gap-2 rounded-xl py-3 active:opacity-80 disabled:opacity-60"
              >
                {sending ? <ActivityIndicator color="#052e1c" size="small" /> : null}
                <Text className="text-sm font-semibold text-emerald-950">
                  {sending
                    ? t('forgot_password.submitting')
                    : t('forgot_password.submit')}
                </Text>
              </Pressable>

              <Pressable onPress={close} disabled={sending} className="mt-3 py-1">
                <Text className="text-center text-sm text-zinc-500">
                  {t('forgot_password.back_to_signin')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
