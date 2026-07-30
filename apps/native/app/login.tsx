import { useState } from 'react';
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
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

type LoginError =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'generic';

const ERROR_KEY: Record<LoginError, string> = {
  invalid_input: 'login.error_invalid_input',
  invalid_credentials: 'login.error_invalid_credentials',
  email_not_confirmed: 'login.error_email_not_confirmed',
  generic: 'login.error_generic',
};

/**
 * B2 — Login NEUTRO de MisterFC (email + contraseña). Marca MisterFC, SIN tema de
 * club (el club aún no se conoce). Valida con `signinSchema` de core y mapea los
 * errores igual que apps/web. La sesión se persiste sola en secure-store.
 */
export default function LoginScreen() {
  const { user, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  // Ya autenticado (o al volver de un login exitoso): fuera del login.
  if (!loading && user) return <Redirect href="/" />;

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
          <View className="items-center gap-1">
            <Text className="text-4xl font-bold text-white">
              {t('login.title')}
            </Text>
            <Text className="text-base text-zinc-300">
              {t('login.subtitle')}
            </Text>
          </View>

          <View className="gap-3">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('login.email')}
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
              placeholder={t('login.password')}
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
                {submitting ? t('login.submitting') : t('login.submit')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
