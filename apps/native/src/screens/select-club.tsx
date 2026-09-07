import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { listPublicClubs, type PublicClub } from '@/data/public-clubs';
import { setStoredLoginClubSlug } from '@/lib/login-club-store';
import { ClubCrest } from '@/ui/club-crest';
import { CREST_WIDTH } from '@/lib/club-logo';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * F14J-5A — SELECTOR DE CLUB, antes de identificarse.
 *
 * Se llega aquí sin sesión y sin club recordado (primera vez), o desde el enlace
 * «cambiar de club» de la pantalla de acceso. Al elegir se recuerda el slug y se
 * va al login de ese club.
 *
 * TRES ESTADOS, NO DOS
 * --------------------
 * `listPublicClubs` devuelve un resultado, no un array, justamente para poder
 * separar «no hay clubes» de «no hemos podido saberlo» — ver la cabecera de
 * `@/data/public-clubs`. Aquí eso se traduce en dos pantallas distintas: el
 * vacío es una frase tranquila y sin botón, y el error trae un REINTENTAR,
 * porque de un fallo de red sí se sale insistiendo.
 *
 * Los textos son los de `portada`, los mismos que la web usa en /clubes: la
 * pantalla es distinta, la situación del usuario es la misma.
 */
export function SelectClubScreen() {
  const t = useTranslations('portada');
  const [clubs, setClubs] = useState<PublicClub[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // El reintento se hace subiendo este contador, no llamando a una función que
  // haga setState: dentro de un efecto, las escrituras de estado van SOLO en el
  // callback async (regla react-hooks/set-state-in-effect, y el mismo patrón que
  // `auth/context` y `PlayerAvatar`).
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await listPublicClubs(supabase);
      if (!active) return;
      if (res.ok) {
        setClubs(res.clubs);
        setFailed(false);
      } else {
        setClubs(null);
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  async function choose(club: PublicClub) {
    await setStoredLoginClubSlug(club.slug);
    router.replace('/login');
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: BRAND.navy }}>
      <View className="flex-1 gap-6 px-6 pt-10">
        <View className="gap-1">
          <Text className="text-3xl font-bold text-white">{t('title')}</Text>
          <Text className="text-base text-zinc-300">{t('subtitle')}</Text>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#ffffff" />
          </View>
        ) : failed ? (
          // NO se dice «no hay clubes»: no lo sabemos.
          <View className="flex-1 items-center justify-center gap-4 px-2">
            <Text className="text-center text-base text-zinc-300">
              {t('error')}
            </Text>
            <Pressable
              onPress={retry}
              style={{ backgroundColor: BRAND.green }}
              className="rounded-xl px-6 py-3 active:opacity-80"
            >
              <Text className="text-base font-semibold text-emerald-950">
                {t('retry')}
              </Text>
            </Pressable>
          </View>
        ) : clubs && clubs.length === 0 ? (
          // La consulta fue bien y el directorio está vacío. Sin botón: no hay
          // nada que reintentar, insistir no lo arreglaría.
          <View className="flex-1 items-center justify-center px-2">
            <Text className="text-center text-base text-zinc-300">
              {t('empty')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={clubs ?? []}
            keyExtractor={(c) => c.id}
            contentContainerClassName="gap-3 pb-10"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void choose(item)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                className="flex-row items-center gap-4 rounded-2xl bg-white/10 p-4 active:opacity-70"
              >
                <ClubCrest
                  name={item.name}
                  logoPath={item.logo_path}
                  size={48}
                  width={CREST_WIDTH.row}
                />
                <Text
                  className="flex-1 text-lg font-semibold text-white"
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
