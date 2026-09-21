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
import {
  recoveryMessageKey,
  submitPasswordRecovery,
  type RecoveryOutcome,
} from '@/auth/password-recovery';
import { callPublicServerEndpoint } from '@/lib/server-api';
import { appLocale, useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { KeyboardModalView } from '@/ui/keyboard';

/**
 * RECUPERAR CONTRASEÑA desde el login de la app.
 *
 * QUIÉN MANDA EL CORREO, desde Correo-B: la WEB, no la app. Sale por Resend en el
 * idioma del destinatario (`profiles.locale`), y eso exige la service-role key, que
 * en un móvil no puede vivir. Aquí solo se pide, contra `/api/auth/password-recovery`.
 *
 * El destino del enlace ya no lo pone la app: lo decide el servidor con el host de la
 * petición. La app NO recibe el enlace del correo —no hay deep links (esquema
 * `misterfc://` declarado, pero sin intentFilters de Android ni associatedDomains de
 * iOS)—, así que el aterrizaje sigue siendo la web, EXACTAMENTE igual que con el
 * enlace de invitación. El formulario de contraseña nueva es el de web, que ya existe
 * y no se toca.
 *
 * NO REVELAR SI EL EMAIL EXISTE (lo más importante de esta pantalla): el endpoint
 * contesta 200 tanto si mandó el correo como si esa dirección no tiene cuenta, y aquí
 * NO se comprueba nada antes de pedirlo. La confirmación es SIEMPRE la misma —"si
 * existe una cuenta asociada a …"—, igual que en la web. Un error solo se enseña
 * cuando la petición falla de verdad (el límite, la red), nunca "ese email no existe".
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
  const [error, setError] = useState<string | null>(null);
  /** Solo con `rate_limited`: los minutos que dijo el servidor. */
  const [retryMinutes, setRetryMinutes] = useState(1);

  function close() {
    if (sending) return;
    setSent(false);
    setError(null);
    setRetryMinutes(1);
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

    setSending(true);
    try {
      // El destino del enlace NO viaja aquí: lo decide el servidor. El `locale` sí,
      // pero solo como respaldo para cuando el destinatario no tiene idioma propio.
      const out: RecoveryOutcome = await submitPasswordRecovery(callPublicServerEndpoint, {
        email: parsed.data.email,
        locale: appLocale(),
      });

      if ('ok' in out) {
        // OJO: un `ok` NO significa que la cuenta exista. El endpoint contesta igual
        // en los dos casos, y la pantalla de confirmación está escrita para eso.
        setSent(true);
      } else {
        if (out.retryAfter) setRetryMinutes(Math.max(1, Math.ceil(out.retryAfter / 60)));
        setError(out.error);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardModalView className="flex-1 items-center justify-center bg-black/60 px-6">
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
                  {t(`forgot_password.${recoveryMessageKey(error)}`, {
                    minutes: retryMinutes,
                  })}
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
      </KeyboardModalView>
    </Modal>
  );
}
