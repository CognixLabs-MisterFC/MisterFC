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
import { appLocale, useLocale, useSetLocale, useTranslations } from '@/locale/provider';
import { LOCALES, type Locale } from '@/locale/catalogs';
import { BRAND } from '@/theme';

/**
 * PERFIL COMPLETO — pantalla COMÚN a las cuatro áreas. PRIMERA pantalla migrada al
 * catálogo COMPARTIDO con la web (`messages/*.json`, namespace `perfil`) vía el hook
 * `useTranslations` (O2-12a). El resto de la app sigue con el `t()` plano hasta que
 * se migre por tandas.
 *
 * Datos + avatar = escritura RLS DIRECTA (su fila / su carpeta en `profile-avatars`),
 * SIN service-role ni route handler. Contraseña por email (`resetPasswordForEmail`).
 * El SELECTOR de idioma cambia la app EN CALIENTE (LocaleProvider) y persiste en
 * `profiles.locale` reutilizando `updateProfileFromClient` (#440). Offline = solo
 * lectura para las escrituras de red (write-guard); el cambio de idioma sí es local.
 */
export function ProfileScreen() {
  const { theme } = useApp();
  const { user } = useSession();
  const online = useIsOnline();
  const t = useTranslations('perfil');
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
        <Text className="text-xl font-semibold text-[#0F1B2E]">{t('title')}</Text>

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
            <DataCard userId={userId} initial={data} online={online} onSaved={refresh} />
            <LanguageCard userId={userId} online={online} onSaved={refresh} />
          </>
        ) : null}

        <AccountCard email={email} online={online} />

        <View className="gap-2">
          {/* Sección de push aún NO migrada al catálogo compartido → t() plano heredado. */}
          <Text className="text-sm text-zinc-400">{t('notifications_title')}</Text>
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
  const t = useTranslations('perfil');
  const [path, setPath] = useState<string | null>(initialPath);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(t('avatar.permission'));
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
      setError(code.includes('large') ? t('errors.avatar_too_large') : t('errors.avatar_mime_invalid'));
      return;
    }
    if (!asset.base64) {
      setError(t('errors.avatar_upload_failed'));
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
      setError(t('errors.avatar_upload_failed'));
      return;
    }
    const res = await updateAvatarPathFromClient(supabase, userId, objectPath);
    setBusy(false);
    if (res.success) {
      setPath(objectPath);
      onChanged();
    } else {
      setError(t('errors.avatar_upload_failed'));
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
      setError(t('errors.avatar_remove_failed'));
    }
  }

  return (
    <Card title={t('section.avatar')}>
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
              label={t('avatar.change')}
              onPress={pick}
              disabled={!online || busy}
              busy={busy}
            />
            {path ? (
              <ActionButton
                label={t('avatar.remove')}
                onPress={remove}
                disabled={!online || busy}
                variant="ghost"
              />
            ) : null}
          </View>
          <Text className="text-xs text-zinc-400">{t('avatar.hint', { maxMb: 2 })}</Text>
          {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

// ── Datos personales (full_name, date_of_birth) ─────────────────────────────────
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
  const t = useTranslations('perfil');
  const [fullName, setFullName] = useState(initial?.full_name ?? '');
  const [dob, setDob] = useState(initial?.date_of_birth ?? '');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function save() {
    if (!online || busy) return; // write-guard
    setBusy(true);
    setState('idle');
    setErrorKey(null);
    // Escribe SOLO sus campos (nombre + fecha). NUNCA locale: eso es de LanguageCard,
    // así no pisa un idioma elegido en otra superficie (p.ej. la web).
    const res = await updateProfileFromClient(supabase, userId, {
      full_name: fullName,
      date_of_birth: dob,
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
    <Card title={t('section.data')}>
      <Field label={t('field.full_name')} value={fullName} onChange={setFullName} />
      <Field
        label={t('field.date_of_birth')}
        value={dob}
        onChange={setDob}
        placeholder="AAAA-MM-DD"
        keyboardType="numbers-and-punctuation"
      />
      <ActionButton label={t('save')} onPress={save} disabled={!online || busy} busy={busy} />
      {state === 'saved' ? (
        <Text className="mt-2 text-xs text-emerald-600">{t('saved')}</Text>
      ) : null}
      {state === 'error' ? (
        <Text className="mt-2 text-xs text-red-600">
          {errorKey ? t(`errors.${errorKey}`) : t('errors.generic')}
        </Text>
      ) : null}
      {!online ? <Text className="mt-2 text-xs text-amber-600">{t('offline')}</Text> : null}
    </Card>
  );
}

// ── Idioma: selector con cambio EN CALIENTE + persistencia en profiles.locale ────
function LanguageCard({
  userId,
  online,
  onSaved,
}: {
  userId: string;
  online: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('perfil');
  const locale = useLocale();
  const setLocale = useSetLocale();

  async function choose(l: Locale) {
    if (l === locale) return;
    // 1) Cambio EN CALIENTE + caché local (secure-store), siempre, también offline.
    setLocale(l);
    // 2) Persistencia en profiles.locale (verdad) reutilizando updateProfileFromClient
    //    (#440), solo online. Escribe SOLO locale (update parcial): NUNCA nombre/fecha,
    //    para no revertir edits sin guardar del formulario de datos.
    if (online) {
      const res = await updateProfileFromClient(supabase, userId, { locale: l });
      if (res.success) onSaved();
    }
  }

  return (
    <Card title={t('field.locale')}>
      <View className="mb-1 flex-row gap-2">
        {LOCALES.map((l) => {
          const selected = locale === l;
          return (
            <Pressable
              key={l}
              onPress={() => choose(l)}
              className={`rounded-full border px-4 py-1.5 ${selected ? 'border-transparent' : 'border-zinc-300'}`}
              style={selected ? { backgroundColor: '#0F1B2E' } : undefined}
            >
              <Text className={`text-xs font-medium ${selected ? 'text-white' : 'text-zinc-600'}`}>
                {t(`locales.${l}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="text-xs text-zinc-400">{t('field.locale_help')}</Text>
    </Card>
  );
}

// ── Cuenta (email readonly + cambiar contraseña por email) ──────────────────────
function AccountCard({ email, online }: { email: string; online: boolean }) {
  const t = useTranslations('perfil');
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (!online || busy || !email) return; // write-guard
    setBusy(true);
    try {
      const base = webBaseUrl();
      const next = `/${appLocale()}/reset-password`;
      const redirectTo = base
        ? `${base}/auth/callback?next=${encodeURIComponent(next)}`
        : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        Alert.alert(t('pw.error_title'), t('pw.error_body'));
      } else {
        Alert.alert(t('pw.sent_title'), t('pw.sent_body', { email }));
      }
    } catch {
      Alert.alert(t('pw.error_title'), t('pw.error_body'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('section.account')}>
      <Text className="text-xs text-zinc-500">{t('field.email')}</Text>
      <Text className="mb-1 text-sm text-[#0F1B2E]">{email || '—'}</Text>
      <Text className="mb-3 text-xs text-zinc-400">{t('field.email_help')}</Text>

      <ActionButton
        label={t('change_password')}
        onPress={changePassword}
        disabled={!online || busy || !email}
        busy={busy}
      />
      <Text className="mt-2 text-xs text-zinc-400">{t('change_password_hint')}</Text>
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
