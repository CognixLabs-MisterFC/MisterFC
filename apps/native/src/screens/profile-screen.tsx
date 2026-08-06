import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  getProfileFromClient,
  updateProfileFromClient,
  updateAvatarPathFromClient,
  clearAvatarPathFromClient,
  signAvatarFromClient,
  avatarUploadSchema,
  profileScopedCacheKey,
  type ProfileData,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { MIME_TO_EXT, base64ToBytes } from '@/lib/image-upload';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen } from '@/ui/feedback';
import { PushSettingsCard } from '@/notifications/push-settings-card';
import { webBaseUrl } from '@/lib/server-api';
import { uuidv4 } from '@/lib/uuid';
import { t, APP_LOCALE } from '@/i18n';
import { BRAND } from '@/theme';

const LOCALES = ['es', 'en', 'va'] as const;

/**
 * PERFIL COMPLETO — pantalla COMÚN a las cuatro áreas (familia, seguidor, staff,
 * dirección). Nada por-rol: la gestión del jugador/consentimientos vive en Familia
 * (C2), no aquí. Reúne datos personales + avatar + contraseña + push (O2-4).
 *
 * TODO es escritura RLS DIRECTA con el cliente del usuario (datos → su fila
 * `profiles`; avatar → su carpeta en el bucket `profile-avatars`). SIN service-role,
 * SIN route handler. La contraseña se cambia por EMAIL (`resetPasswordForEmail`,
 * como la web), no con un formulario in-app. El `locale` SE PERSISTE (lo consumen
 * emails/notificaciones server-side) pero NO cambia el idioma de la app en caliente
 * (eso es O2-12). Offline = solo lectura: los botones de guardar/subir/contraseña se
 * deshabilitan sin conexión (write-guard).
 */
export function ProfileScreen() {
  const { theme } = useApp();
  const { user } = useSession();
  const online = useIsOnline();
  const userId = user?.id ?? null;
  const email = user?.email ?? '';
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<ProfileData | null>(
    profileScopedCacheKey('profile', userId ?? 'none'),
    (sb) => (userId ? getProfileFromClient(sb, userId) : Promise.resolve(null)),
  );

  if (loading) return <LoadingScreen />;

  const fallback = (data?.full_name?.trim() || email || '·').slice(0, 2);

  return (
    <ScrollView className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <View className="gap-4 p-6">
        <Text className="text-xl font-semibold text-[#0F1B2E]">{t('nav.perfil')}</Text>

        {userId ? (
          <>
            <AvatarCard
              userId={userId}
              initialPath={data?.avatar_url ?? null}
              accent={accent}
              fallback={fallback}
              online={online}
              onChanged={refresh}
            />
            <DataCard
              userId={userId}
              initial={data}
              online={online}
              onSaved={refresh}
            />
          </>
        ) : null}

        <AccountCard email={email} online={online} />

        <View className="gap-2">
          <Text className="text-sm text-zinc-400">{t('push.section_title')}</Text>
          <PushSettingsCard />
        </View>
      </View>
    </ScrollView>
  );
}

// ── Avatar (bucket `profile-avatars`, subida RLS a <uid>/, patrón C2) ────────────
function AvatarCard({
  userId,
  initialPath,
  accent,
  fallback,
  online,
  onChanged,
}: {
  userId: string;
  initialPath: string | null;
  accent: string;
  fallback: string;
  online: boolean;
  onChanged: () => void;
}) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Firma la ruta actual bajo demanda (bucket privado, online-only). Set-state solo
  // dentro del callback async (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    let active = true;
    (async () => {
      const signed = online && path ? await signAvatarFromClient(supabase, path) : null;
      if (active) setUrl(signed);
    })();
    return () => {
      active = false;
    };
  }, [path, online]);

  async function pick() {
    if (!online || busy) return; // write-guard
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(t('perfil.avatar_permission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const mime = asset.mimeType ?? 'image/jpeg';
    const size = asset.fileSize ?? (asset.base64 ? Math.floor((asset.base64.length * 3) / 4) : 0);
    const validation = avatarUploadSchema.safeParse({ mimeType: mime, size });
    if (!validation.success) {
      const code = validation.error.issues[0]?.message ?? '';
      setError(code.includes('large') ? t('perfil.avatar_err_large') : t('perfil.avatar_err_mime'));
      return;
    }
    if (!asset.base64) {
      setError(t('perfil.avatar_err_generic'));
      return;
    }

    setBusy(true);
    const ext = MIME_TO_EXT[mime] ?? 'jpg';
    const objectPath = `${userId}/${uuidv4()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('profile-avatars')
      .upload(objectPath, base64ToBytes(asset.base64), { contentType: mime, upsert: false });
    if (uploadError) {
      setBusy(false);
      setError(t('perfil.avatar_err_generic'));
      return;
    }
    const res = await updateAvatarPathFromClient(supabase, userId, objectPath);
    setBusy(false);
    if (res.success) {
      setPath(objectPath);
      onChanged();
    } else {
      setError(t('perfil.avatar_err_generic'));
    }
  }

  async function remove() {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    const res = await clearAvatarPathFromClient(supabase, userId);
    setBusy(false);
    if (res.success) {
      setPath(null);
      onChanged();
    } else {
      setError(t('perfil.avatar_err_generic'));
    }
  }

  return (
    <Card title={t('perfil.avatar_title')}>
      <View className="flex-row items-center gap-4">
        <View
          className="items-center justify-center overflow-hidden rounded-full"
          style={{ width: 72, height: 72, backgroundColor: accent }}
        >
          {url ? (
            <Image source={{ uri: url }} style={{ width: 72, height: 72 }} resizeMode="cover" />
          ) : (
            <Text className="font-bold text-white" style={{ fontSize: 24 }}>
              {fallback.toUpperCase() || '·'}
            </Text>
          )}
        </View>
        <View className="flex-1 gap-2">
          <View className="flex-row flex-wrap gap-2">
            <ActionButton
              label={t('perfil.avatar_change')}
              onPress={pick}
              disabled={!online || busy}
              busy={busy}
            />
            {path ? (
              <ActionButton
                label={t('perfil.avatar_remove')}
                onPress={remove}
                disabled={!online || busy}
                variant="ghost"
              />
            ) : null}
          </View>
          <Text className="text-xs text-zinc-400">{t('perfil.avatar_hint')}</Text>
          {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

// ── Datos personales (full_name, date_of_birth, locale) ─────────────────────────
function DataCard({
  userId,
  initial,
  online,
  onSaved,
}: {
  userId: string;
  initial: ProfileData | null;
  online: boolean;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(initial?.full_name ?? '');
  const [dob, setDob] = useState(initial?.date_of_birth ?? '');
  const [locale, setLocale] = useState<string>(initial?.locale ?? 'es');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function save() {
    if (!online || busy) return; // write-guard
    setBusy(true);
    setState('idle');
    setErrorKey(null);
    const res = await updateProfileFromClient(supabase, userId, {
      full_name: fullName,
      date_of_birth: dob,
      locale,
    });
    setBusy(false);
    if (res.success) {
      setState('saved');
      onSaved();
    } else {
      setState('error');
      setErrorKey(res.error);
    }
  }

  return (
    <Card title={t('perfil.data_title')}>
      <Field label={t('perfil.field_full_name')} value={fullName} onChange={setFullName} />
      <Field
        label={t('perfil.field_dob')}
        value={dob}
        onChange={setDob}
        placeholder="AAAA-MM-DD"
        keyboardType="numbers-and-punctuation"
      />

      <Text className="mb-1 text-xs text-zinc-500">{t('perfil.field_locale')}</Text>
      <View className="mb-1 flex-row gap-2">
        {LOCALES.map((l) => {
          const selected = locale === l;
          return (
            <Pressable
              key={l}
              onPress={() => setLocale(l)}
              className={`rounded-full border px-4 py-1.5 ${selected ? 'border-transparent' : 'border-zinc-300'}`}
              style={selected ? { backgroundColor: '#0F1B2E' } : undefined}
            >
              <Text className={`text-xs font-medium ${selected ? 'text-white' : 'text-zinc-600'}`}>
                {t(`perfil.locale_${l}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-3 text-xs text-zinc-400">{t('perfil.locale_hint')}</Text>

      <ActionButton
        label={t('perfil.save')}
        onPress={save}
        disabled={!online || busy}
        busy={busy}
      />
      {state === 'saved' ? (
        <Text className="mt-2 text-xs text-emerald-600">{t('perfil.saved')}</Text>
      ) : null}
      {state === 'error' ? (
        <Text className="mt-2 text-xs text-red-600">
          {errorKey ? t(`perfil.err_${errorKey}`) : t('perfil.err_generic')}
        </Text>
      ) : null}
      {!online ? (
        <Text className="mt-2 text-xs text-amber-600">{t('perfil.offline')}</Text>
      ) : null}
    </Card>
  );
}

// ── Cuenta (email readonly + cambiar contraseña por email) ──────────────────────
function AccountCard({ email, online }: { email: string; online: boolean }) {
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (!online || busy || !email) return; // write-guard
    setBusy(true);
    try {
      const base = webBaseUrl();
      const next = `/${APP_LOCALE}/reset-password`;
      const redirectTo = base
        ? `${base}/auth/callback?next=${encodeURIComponent(next)}`
        : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        Alert.alert(t('perfil.pw_error_title'), t('perfil.pw_error_body'));
      } else {
        Alert.alert(t('perfil.pw_sent_title'), t('perfil.pw_sent_body', { email }));
      }
    } catch {
      Alert.alert(t('perfil.pw_error_title'), t('perfil.pw_error_body'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('perfil.account_title')}>
      <Text className="text-xs text-zinc-500">{t('perfil.field_email')}</Text>
      <Text className="mb-1 text-sm text-[#0F1B2E]">{email || '—'}</Text>
      <Text className="mb-3 text-xs text-zinc-400">{t('perfil.email_help')}</Text>

      <ActionButton
        label={t('perfil.change_password')}
        onPress={changePassword}
        disabled={!online || busy || !email}
        busy={busy}
      />
      <Text className="mt-2 text-xs text-zinc-400">{t('perfil.change_password_hint')}</Text>
    </Card>
  );
}

// ── Primitivas de UI (mismo lenguaje visual que la gestión de Familia) ──────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-2 text-sm font-semibold text-[#0F1B2E]">{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numbers-and-punctuation';
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs text-zinc-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        keyboardType={keyboardType ?? 'default'}
        maxLength={120}
        placeholderTextColor="#a1a1aa"
        className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
      />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  busy,
  variant = 'outline',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'outline' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center gap-2 self-start rounded-full px-4 py-2 active:opacity-60 ${
        variant === 'ghost' ? '' : 'border border-zinc-300'
      }`}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {busy ? <ActivityIndicator size="small" color={BRAND.navy} /> : null}
      <Text
        className={`text-sm font-medium ${variant === 'ghost' ? 'text-zinc-500' : 'text-[#0F1B2E]'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
