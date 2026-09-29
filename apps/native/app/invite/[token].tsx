import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { acceptInvitationWithProfileSchema, openInBrowserPath } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/auth/session';
import { useTranslations, useLocale } from '@/locale/provider';
import { BRAND } from '@/theme';
import { legalUrl } from '@/legal/links';
import { submitSelfAccept, selfAcceptMessageKey } from '@/invitations/self-accept';
import {
  fetchInvitePreflight,
  preflightMandaAlNavegador,
  preflightSePuedeReintentar,
  type InvitePreflightOutcome,
} from '@/invitations/preflight';
import { callPublicServerEndpoint, webBaseUrl } from '@/lib/server-api';
import { KeyboardScrollView } from '@/ui/keyboard';

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

  /**
   * R-5 · N-2 — QUE INVITACION ES ESTA, antes de pintar el formulario.
   *
   * `null` = todavia no se sabe. No es un detalle: el estado inicial NO puede ser
   * «es self», porque entonces el primer fotograma volveria a afirmar lo que aun no
   * se ha comprobado, que es justo el fallo que esto cierra.
   *
   * El efecto va ANTES del `if (!token)` de abajo por las reglas de los hooks: un
   * return antes de un hook cambia el orden entre renders.
   */
  const [respuesta, setRespuesta] = useState<{
    para: string;
    intento: number;
    out: InvitePreflightOutcome;
  } | null>(null);
  const [intento, setIntento] = useState(0);
  /**
   * N-3b — `Linking.openURL` puede rechazar (un movil sin navegador que atienda
   * https, o un perfil de trabajo que lo bloquea). Si eso pasa NO se traga el
   * fallo: el rotulo de encima del enlace cambia y pide copiarlo a mano, que es lo
   * que ya funcionaba antes de haber boton.
   */
  const [falloAlAbrir, setFalloAlAbrir] = useState(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    void (async () => {
      const out = await fetchInvitePreflight(callPublicServerEndpoint, token);
      // Sin esto, volver atras mientras la peticion vuela deja un setState sobre una
      // pantalla desmontada.
      if (vivo) setRespuesta({ para: token, intento, out });
    })();
    return () => {
      vivo = false;
    };
  }, [token, intento]);

  /**
   * El veredicto vale SOLO para el token y el intento de ahora; si cambia cualquiera de
   * los dos, esto vuelve a `null` —«comprobando»— por si solo.
   *
   * Se guarda con su par en vez de poner el estado a `null` dentro del efecto, que es lo
   * primero que escribi: eso es una cascada de renders y el lint del React Compiler lo
   * caza (`eslint . --max-warnings=0` en esta app, asi que habria tumbado CI). Y ademas
   * esta forma arregla algo que aquella no: al reintentar, y si expo-router reusa la
   * pantalla con otro token, no se enseña ni un fotograma del veredicto ANTERIOR.
   */
  const pre =
    respuesta && respuesta.para === token && respuesta.intento === intento
      ? respuesta.out
      : null;

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  if (!token) {
    return (
      <Verdict
        message={t('error_not_found')}
        actionLabel={t('go_to_signin')}
        onAction={() => router.replace('/login')}
      />
    );
  }

  // ── R-5 · N-2 · Mientras no se sepa QUE invitacion es, no se pinta ni un campo ──
  if (pre === null) {
    return <Comprobando texto={t('checking')} />;
  }

  if ('error' in pre) {
    const code = pre.error;
    const sePuedeReintentar = preflightSePuedeReintentar(code);
    // El unico veredicto que la web SI sabe atender es `not_self` (el padre que abre su
    // invitacion desde el movil). Los demas son del token y en el navegador darian lo
    // mismo, asi que ofrecer el enlace ahi seria mandar a alguien a un callejon.
    /**
     * N-3b — EL ENLACE ES EL ABRIDOR, no la ruta de invitacion.
     *
     * `/{locale}/invite/{token}` la reclama esta misma app (autoVerify en Android,
     * AASA en iOS), asi que abrirla con `Linking.openURL` puede devolver al tutor
     * aqui, al sitio del que viene. `/{locale}/abrir-invitacion/{token}` no la
     * reclama nadie: el sistema la entrega al navegador y el 307 salta a la
     * invitacion ya DENTRO del navegador. Medido en dispositivo con la version de
     * pruebas internas de Play antes de poner el boton (N-3a, #745).
     *
     * El MISMO enlace sirve para el boton y para el texto copiable: una sola URL, un
     * solo comportamiento, y es la que se verifico.
     *
     * La BASE sale de `webBaseUrl()` —como ya hacia esta pantalla, y por eso existe
     * `error_no_web_url`— y el CAMINO de core, para que el segmento siga escrito en
     * un unico sitio.
     */
    const enlace =
      preflightMandaAlNavegador(code) && webBaseUrl()
        ? `${webBaseUrl()}${openInBrowserPath(locale, token)}`
        : null;

    return (
      <Verdict
        message={
          code === 'rate_limited' && pre.retryAfter
            ? t('error_rate_limited_in', {
                minutes: Math.max(1, Math.ceil(pre.retryAfter / 60)),
              })
            : t(selfAcceptMessageKey(code))
        }
        link={enlace}
        linkLabel={falloAlAbrir ? t('open_failed') : t('link_to_copy')}
        openLabel={enlace ? t('open_in_browser') : undefined}
        onOpen={
          enlace
            ? () => {
                setFalloAlAbrir(false);
                void Linking.openURL(enlace).catch(() => setFalloAlAbrir(true));
              }
            : undefined
        }
        actionLabel={sePuedeReintentar ? t('retry') : t('go_to_signin')}
        onAction={sePuedeReintentar ? reintentar : () => router.replace('/login')}
      />
    );
  }

  // A partir de aqui el servidor ha dicho que SI: es una invitacion de cuenta propia del
  // menor. El `self_note` de abajo ya no es una suposicion.

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
      {/* Aquí estaba el KeyboardAvoidingView de React Native con
          `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`: en Android,
          undefined = no hace nada. Se va entero; lo hace KeyboardScrollView. */}
      <KeyboardScrollView
        className="flex-1"
        contentContainerClassName="px-6 py-8"
        keyboardShouldPersistTaps="handled"
      >
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
      </KeyboardScrollView>
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
/**
 * R-5 · N-2 — mientras se pregunta de que tipo es la invitacion.
 *
 * Una pantalla en blanco durante una peticion de red que puede tardar es
 * indistinguible de una app rota; y lo que NO puede hacer es adelantar el formulario
 * del menor «mientras tanto», que es la afirmacion sin comprobar que N-2 viene a quitar.
 */
function Comprobando({ texto }: { texto: string }) {
  return (
    <SafeAreaView
      className="flex-1 items-center justify-center px-8"
      style={{ backgroundColor: BRAND.navy }}
    >
      <ActivityIndicator color="#fff" />
      <Text className="mt-4 text-center text-base text-zinc-300">{texto}</Text>
    </SafeAreaView>
  );
}

function Verdict({
  message,
  actionLabel,
  onAction,
  link,
  linkLabel,
  openLabel,
  onOpen,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** R-5 · N-2 — el enlace que hay que abrir en el navegador, si lo hay. */
  link?: string | null;
  linkLabel?: string;
  /** N-3b — abre ese enlace en el navegador. Solo cuando hay enlace. */
  openLabel?: string;
  onOpen?: () => void;
}) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center px-8" style={{ backgroundColor: BRAND.navy }}>
      <Text className="text-center text-lg font-semibold text-zinc-200">{message}</Text>
      {link ? (
        <View className="mt-6 w-full">
          {/*
            N-3b — EL BOTON VA PRIMERO y el enlace queda debajo como respaldo.
            `Linking.openURL` es el mismo que ya abre los documentos legales de esta
            pantalla y del paywall: no estrena nada. El enlace apunta a la ruta
            ABRIDORA, que no reclama ni Android ni iOS, asi que no puede devolver al
            tutor a esta misma pantalla — medido en dispositivo (N-3a, #745).
          */}
          {openLabel && onOpen ? (
            <Pressable
              onPress={onOpen}
              accessibilityRole="button"
              className="mb-5 w-full rounded-xl px-6 py-3 active:opacity-70"
              style={{ backgroundColor: BRAND.green }}
            >
              <Text className="text-center text-base font-semibold text-white">{openLabel}</Text>
            </Pressable>
          ) : null}
          <Text className="text-center text-sm text-zinc-400">{linkLabel}</Text>
          {/*
            El texto SIGUE siendo `selectable` y sigue sin `expo-clipboard`: es el
            respaldo si `openURL` rechaza, y mantener pulsado ya ofrece «Copiar» en
            las dos plataformas sin añadir un modulo nativo. Con el boton puesto,
            `expo-clipboard` se queda fuera para siempre.
          */}
          <Text
            selectable
            className="mt-2 rounded-xl bg-white/10 px-4 py-3 text-center text-sm text-zinc-200"
          >
            {link}
          </Text>
        </View>
      ) : null}
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
