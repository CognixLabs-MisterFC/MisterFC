import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { signinSchema } from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { webBaseUrl } from '@/lib/server-api';
import { useSession } from '@/auth/session';
import { ForgotPasswordModal } from '@/screens/forgot-password-modal';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { getPublicClubBySlug, type PublicClub } from '@/data/public-clubs';
import {
  clearStoredLoginClubSlug,
  getStoredLoginClubSlug,
} from '@/lib/login-club-store';
import { ClubCrest } from '@/ui/club-crest';
import { CREST_WIDTH } from '@/lib/club-logo';

type LoginError =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'generic';

// Subclaves dentro del namespace compartido `auth.signin` (los textos de la app
// difieren de los de la web → claves propias `app_error_*`).
const ERROR_KEY: Record<LoginError, string> = {
  invalid_input: 'app_error_invalid_input',
  invalid_credentials: 'app_error_invalid_credentials',
  email_not_confirmed: 'app_error_email_not_confirmed',
  generic: 'app_error_generic',
};

/** Cómo ha ido la resolución del club recordado (F14J-5A). */
type ClubState =
  | { phase: 'resolving' }
  /** Hay club recordado y se ha resuelto: la pantalla lleva su escudo. */
  | { phase: 'club'; club: PublicClub }
  /** No hay club recordado, o el recordado ya no existe → al selector. */
  | { phase: 'none' }
  /** No se ha podido resolver (red). Se entra igual, sin escudo. */
  | { phase: 'unknown' };

/**
 * B2 — Login de MisterFC (email + contraseña). Valida con `signinSchema` de core
 * y mapea los errores igual que apps/web. La sesión se persiste sola en
 * secure-store.
 *
 * F14J-5A — LA PUERTA ES DE UN CLUB. Al abrir sin sesión se mira qué club se
 * recordó en el dispositivo:
 *
 *   · sin club recordado      → al selector (`/seleccionar-club`)
 *   · con club recordado      → aquí, con su ESCUDO y su nombre
 *   · el club ya no existe    → se olvida y al selector
 *   · no se ha podido saber   → SE ENTRA IGUAL, con la cabecera neutra de antes
 *
 * Ese último caso es el que importa: un fallo de red al resolver el club no
 * puede dejar a nadie fuera de su cuenta. El escudo es decoración de la puerta;
 * la puerta tiene que abrirse igual. Y no se manda al selector, que necesita la
 * misma red que acaba de fallar y dejaría al usuario dando vueltas.
 *
 * El gatekeeper de `app/index.tsx` NO cambia: sigue mandando aquí a quien no
 * tiene sesión. La decisión de club vive en esta pantalla, que es la que la
 * necesita.
 *
 * RECUPERAR CONTRASEÑA: acceso al modal (ver `ForgotPasswordModal`). Se OCULTA si
 * no hay dominio web configurado (`EXPO_PUBLIC_WEB_URL`), porque el enlace del
 * correo aterriza en la web: sin dominio no hay a dónde llevar al usuario, y es
 * preferible no ofrecer la puerta a mandar un correo que acabe en cualquier sitio.
 * Es una constante de build (Metro la inlinea), así que no parpadea.
 */
export default function LoginScreen() {
  const { user, loading } = useSession();
  const t = useTranslations('auth.signin');
  const tShell = useTranslations('shell');
  const tClub = useTranslations('clubLogin');
  const [clubState, setClubState] = useState<ClubState>({ phase: 'resolving' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const canRecover = webBaseUrl() !== '';

  // Resolución del club recordado. Solo interesa mientras NO hay sesión: con
  // sesión esta pantalla se va por el Redirect de abajo.
  useEffect(() => {
    let active = true;
    void (async () => {
      const slug = await getStoredLoginClubSlug();
      if (!active) return;
      if (!slug) {
        setClubState({ phase: 'none' });
        return;
      }
      const res = await getPublicClubBySlug(supabase, slug);
      if (!active) return;
      if (!res.ok) {
        // Fallo de red: ni escudo ni selector. Se entra igual.
        setClubState({ phase: 'unknown' });
        return;
      }
      if (!res.club) {
        // La consulta fue bien y el club no está: se olvida para no volver a
        // preguntar por él en cada apertura.
        await clearStoredLoginClubSlug();
        if (!active) return;
        setClubState({ phase: 'none' });
        return;
      }
      setClubState({ phase: 'club', club: res.club });
    })();
    return () => {
      active = false;
    };
  }, []);

  async function changeClub() {
    await clearStoredLoginClubSlug();
    router.replace('/seleccionar-club');
  }

  // Ya autenticado (o al volver de un login exitoso): fuera del login.
  if (!loading && user) return <Redirect href="/" />;

  // Mientras se resuelve el club, el mismo fondo y un spinner: así la cabecera
  // no salta de neutra a club a la vista del usuario.
  if (clubState.phase === 'resolving') {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: BRAND.navy }}
      >
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  // Sin club recordado (primera vez, o el recordado ya no existe) → a elegirlo.
  if (clubState.phase === 'none') {
    return <Redirect href="/seleccionar-club" />;
  }

  const club = clubState.phase === 'club' ? clubState.club : null;

  async function onSubmit() {
    setError(null);
    const parsed = signinSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('invalid_input');
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setSubmitting(false);

    if (signInError) {
      const code = 'code' in signInError ? signInError.code : undefined;
      const msg = signInError.message?.toLowerCase() ?? '';
      if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
        setError('invalid_credentials');
      } else if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
        setError('email_not_confirmed');
      } else {
        setError('generic');
      }
      return;
    }

    router.replace('/');
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: BRAND.navy }}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 justify-center gap-6 px-6">
          {/* Con club: manda el ESCUDO. Sin club resuelto (solo por fallo de
              red): la cabecera neutra de siempre. El fondo NO cambia — no se usa
              primary_color, que ni viaja en la RPC ni se va a añadir. */}
          {club ? (
            <View className="items-center gap-3">
              <ClubCrest
                name={club.name}
                logoPath={club.logo_path}
                size={96}
                width={CREST_WIDTH.hero}
              />
              <Text
                className="text-2xl font-bold text-white"
                numberOfLines={2}
              >
                {club.name}
              </Text>
              <Text className="text-base text-zinc-300">
                {tClub('subtitle')}
              </Text>
            </View>
          ) : (
            <View className="items-center gap-1">
              <Text className="text-4xl font-bold text-white">
                {tShell('app_name')}
              </Text>
              <Text className="text-base text-zinc-300">
                {t('app_subtitle')}
              </Text>
            </View>
          )}

          <View className="gap-3">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('email_label')}
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              editable={!submitting}
              className="rounded-xl bg-white/10 px-4 py-3 text-base text-white"
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('password_label')}
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!submitting}
              onSubmitEditing={onSubmit}
              className="rounded-xl bg-white/10 px-4 py-3 text-base text-white"
            />

            {error && (
              <Text className="text-sm text-red-400">
                {t(ERROR_KEY[error])}
              </Text>
            )}

            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              style={{ backgroundColor: BRAND.green }}
              className="mt-2 flex-row items-center justify-center gap-2 rounded-xl py-3.5 active:opacity-80 disabled:opacity-60"
            >
              {submitting && <ActivityIndicator color="#052e1c" size="small" />}
              <Text className="text-base font-semibold text-emerald-950">
                {submitting ? t('submitting') : t('submit')}
              </Text>
            </Pressable>

            {canRecover ? (
              <Pressable
                onPress={() => setForgotOpen(true)}
                disabled={submitting}
                className="mt-1 py-2 active:opacity-70"
              >
                <Text className="text-center text-sm text-zinc-300 underline">
                  {t('forgot_password_link')}
                </Text>
              </Pressable>
            ) : null}

            {/* La salida. Va SIEMPRE que haya club a la vista: sin ella, quien
                se equivoca de club se queda encerrado en esa puerta, porque la
                elección se recuerda entre aperturas. */}
            {club ? (
              <Pressable
                onPress={() => void changeClub()}
                disabled={submitting}
                accessibilityRole="button"
                className="py-2 active:opacity-70"
              >
                <Text className="text-center text-sm text-zinc-300 underline">
                  {tClub('changeClub')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <ForgotPasswordModal
        visible={forgotOpen}
        onClose={() => setForgotOpen(false)}
        initialEmail={email}
      />
    </SafeAreaView>
  );
}
