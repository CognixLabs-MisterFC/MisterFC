import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { acceptInvitationWithProfileSchema } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useTranslations, useLocale } from '@/locale/provider';
import { BRAND } from '@/theme';
import { legalUrl } from '@/legal/links';
import { submitSelfAccept, selfAcceptMessageKey } from '@/invitations/self-accept';
import { callPublicServerEndpoint } from '@/lib/server-api';

/**
 * R-3 — Pantalla nativa de invitación a la CUENTA PROPIA del menor.
 *
 * Se llega por el enlace del correo (deep link de BUG-3) y NO hay sesión: el token de la
 * URL es la credencial. Toda la decisión de si esa invitación se puede atender vive en
 * el servidor (`decideSelfAccept`, R-2); aquí solo se pide lo que hace falta y se enseña
 * lo que conteste.
 *
 * SOLO EL CASO SELF. Las invitaciones de tutor traen datos del hijo y decisiones de
 * imagen que MN-3 reserva al tutor; el endpoint las rechaza con `not_self` y esta
 * pantalla lo dice y manda a la web, que es donde ese formulario existe.
 *
 * LOS LEGALES ESTÁN AQUÍ, y no es un adorno: el menor está creando SU cuenta, así que
 * acepta los términos y la privacidad de esa cuenta (MN-3 los mantiene explícitamente
 * para él). Hasta ahora los enlaces a los textos solo existían dentro del muro de pago;
 * el módulo se ha sacado de `subscription/` a `legal/` porque ya no es del muro.
 *
 * ⚠️ El segmento `invite` está en PUBLIC_ROUTE_SEGMENTS y en SUBSCRIPTION_EXEMPT_SEGMENTS
 * (nav/config). Sin lo primero el SessionGuard rebota al login; sin lo segundo el muro de
 * pago la empuja. En ambos casos el síntoma es una pantalla en blanco, sin excepción.
 */
/**
 * R-4 — veredictos TERMINALES: con estos el formulario no sirve de nada, porque el
 * problema no está en lo que el usuario escriba.
 *
 * Es la mitad de «que no se quede colgado»: sin esto la pantalla enseñaba el error en
 * rojo y dejaba el formulario puesto, invitando a reintentar algo que iba a fallar
 * siempre. Ahora se sustituye por una salida.
 *
 * `not_claimable` es el caso del CORREO YA REGISTRADO, el que no puede abrir la app: su
 * correo va por la plantilla de recuperación, que sigue apuntando a
 * `{{ .ConfirmationURL }}` y abre el navegador (BUG-3: esa plantilla NECESITA la sesión
 * que crea el verify de Supabase, así que no se puede cambiar). En la web ese camino
 * está resuelto —`chooseInviteForm` le da el formulario de iniciar sesión— pero si el
 * enlace llega igualmente a la app, aquí se le dice qué hacer en vez de dejarlo mirando
 * un error.
 */
const TERMINALES = new Set([
  'not_found',
  'invalid',
  'expired',
  'already_accepted',
  'not_self',
  'not_claimable',
]);

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTranslations('invite');
  const locale = useLocale();
  // Si ya hay sesión (el enlace suele llegar al correo del TUTOR, que probablemente
  // tenga la app abierta), entrar cambiaría de cuenta. Se avisa antes, no después.
  const { user } = useSession();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; retryAfter?: number } | null>(null);

  if (!token) {
    return (
      <Verdict
        message={t('error_not_found')}
        actionLabel={t('go_to_signin')}
        onAction={() => router.replace('/login')}
      />
    );
  }

  async function onSubmit() {
    setError(null);

    // Se valida ANTES de salir a la red con el MISMO schema que usa la web: así el
    // mensaje que ve el menor por un nombre corto o una contraseña que no coincide es
    // el mismo por los dos caminos, y no gasta un intento del contador.
    const parsed = acceptInvitationWithProfileSchema.safeParse({
      full_name: fullName,
      phone,
      date_of_birth: dateOfBirth || null,
      password,
      confirm,
    });
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? 'invalid_input';
      setError({ code: code === 'phone_required' ? 'phone_missing' : code });
      return;
    }
    if (!acceptTerms || !acceptPrivacy) {
      setError({ code: 'consent_required' });
      return;
    }

    setSubmitting(true);
    const out = await submitSelfAccept(callPublicServerEndpoint, {
      token,
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      date_of_birth: parsed.data.date_of_birth ?? null,
      password: parsed.data.password,
      confirm: parsed.data.confirm,
      accept_terms: true,
      accept_privacy: true,
      locale,
    });

    if ('error' in out) {
      setSubmitting(false);
      setError({ code: out.error, ...(out.retryAfter ? { retryAfter: out.retryAfter } : {}) });
      return;
    }

    // La sesión la abre la app con los tokens que devuelve el endpoint. `setSession`
    // dispara `onAuthStateChange` → SessionProvider se entera → el gatekeeper de `/`
    // manda a su área. No se navega a una pantalla concreta a propósito: el área
    // depende del rol y eso ya lo resuelve la raíz.
    const { error: sessErr } = await supabase.auth.setSession({
      access_token: out.ok.accessToken,
      refresh_token: out.ok.refreshToken,
    });
    setSubmitting(false);
    if (sessErr) {
      setError({ code: 'no_session' });
      return;
    }
    router.replace('/');
  }

  if (error && TERMINALES.has(error.code)) {
    return (
      <Verdict
        message={t(selfAcceptMessageKey(error.code))}
        actionLabel={t('go_to_signin')}
        onAction={() => router.replace('/login')}
      />
    );
  }

  const errorText = error
    ? error.retryAfter
      ? t('error_rate_limited_in', { minutes: Math.max(1, Math.ceil(error.retryAfter / 60)) })
      : t(selfAcceptMessageKey(error.code))
    : null;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: BRAND.navy }}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="px-6 py-8" keyboardShouldPersistTaps="handled">
          <Text className="text-2xl font-bold text-white">{t('title')}</Text>
          <Text className="mt-3 text-sm text-zinc-300">{t('self_note')}</Text>

          {user?.email ? (
            <Text className="mt-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
              {t('session_swap_warning', { email: user.email })}
            </Text>
          ) : null}

          <Field
            label={t('full_name_label')}
            placeholder={t('full_name_placeholder')}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
          <Field
            label={t('phone_label')}
            placeholder={t('phone_placeholder')}
            hint={t('phone_hint')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Field
            label={`${t('date_of_birth_label')} ${t('optional')}`}
            placeholder="AAAA-MM-DD"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            autoCapitalize="none"
          />
          <Field
            label={t('password_label')}
            hint={t('password_hint')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Field
            label={t('confirm_label')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />

          <Text className="mt-6 text-sm text-zinc-300">{t('consent_intro')}</Text>
          <Consent
            checked={acceptTerms}
            onToggle={() => setAcceptTerms((v) => !v)}
            label={t('consent_accept_terms')}
            viewLabel={t('consent_view')}
            onView={() => void Linking.openURL(legalUrl('terminos', locale))}
          />
          <Consent
            checked={acceptPrivacy}
            onToggle={() => setAcceptPrivacy((v) => !v)}
            label={t('consent_accept_privacy')}
            viewLabel={t('consent_view')}
            onView={() => void Linking.openURL(legalUrl('privacidad', locale))}
          />

          {errorText ? (
            <Text className="mt-5 text-sm text-red-400" accessibilityRole="alert">
              {errorText}
            </Text>
          ) : null}

          <Pressable
            disabled={submitting}
            onPress={() => void onSubmit()}
            className="mt-6 items-center rounded-xl px-5 py-4"
            style={{ backgroundColor: BRAND.green, opacity: submitting ? 0.6 : 1 }}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-semibold text-white">
                {t('set_password_submit')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Pantalla terminal: el token no da para formulario (caducado, ya aceptado, no existe,
 * no es de cuenta propia, o el correo ya tenía cuenta).
 *
 * SIEMPRE con salida. Una pantalla sin ningún botón en una app que se acaba de abrir
 * desde un correo es un callejón: el usuario no tiene ni historial al que volver.
 */
function Verdict({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center px-8" style={{ backgroundColor: BRAND.navy }}>
      <Text className="text-center text-lg font-semibold text-zinc-200">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          className="mt-8 rounded-xl px-6 py-3"
          style={{ backgroundColor: BRAND.green }}
        >
          <Text className="text-base font-semibold text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View className="mt-5">
      <Text className="mb-2 text-sm font-medium text-zinc-200">{label}</Text>
      <TextInput
        className="rounded-xl bg-white/10 px-4 py-3 text-base text-white"
        placeholderTextColor="#8A94A6"
        {...input}
      />
      {hint ? <Text className="mt-1 text-xs text-zinc-400">{hint}</Text> : null}
    </View>
  );
}

function Consent({
  checked,
  onToggle,
  label,
  viewLabel,
  onView,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  viewLabel: string;
  onView: () => void;
}) {
  return (
    <View className="mt-3 flex-row items-center">
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        className="mr-3 h-6 w-6 items-center justify-center rounded border"
        style={{ borderColor: checked ? BRAND.green : '#8A94A6', backgroundColor: checked ? BRAND.green : 'transparent' }}
      >
        {checked ? <Text className="text-xs font-bold text-white">✓</Text> : null}
      </Pressable>
      <Text className="flex-1 text-sm text-zinc-200">{label}</Text>
      <Pressable onPress={onView} accessibilityRole="link" className="ml-3">
        <Text className="text-sm underline" style={{ color: BRAND.green }}>
          {viewLabel}
        </Text>
      </Pressable>
    </View>
  );
}
