import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { clubCrestUrls, clubInitials } from '@/lib/club-logo';

/**
 * F14J-5A — El escudo de un club en las pantallas previas al login.
 *
 * Tres escalones, de mejor a peor, y ninguno deja un hueco en blanco:
 *
 *   1. la variante redimensionada en el servidor (la que se pide),
 *   2. el objeto original, si la anterior falla,
 *   3. las iniciales del club sobre un cuadro neutro.
 *
 * El escalón 3 es también lo que se ve MIENTRAS carga, así que la pantalla nunca
 * salta de vacío a lleno: el hueco ya tiene el tamaño y el color definitivos y
 * la imagen aparece encima. En una pantalla de acceso, con la red que haya, eso
 * importa más que el escudo en sí.
 *
 * El bucket es público: aquí no se firma nada ni hace falta sesión.
 */
export function ClubCrest({
  name,
  logoPath,
  size,
  width,
}: {
  name: string;
  logoPath: string | null;
  /** Lado en px con el que se PINTA. */
  size: number;
  /** Anchura que se PIDE al servidor (CREST_WIDTH.row | .hero). */
  width: number;
}) {
  const urls = clubCrestUrls(logoPath, width);
  // 'primary' → transformada; 'fallback' → original; 'none' → iniciales.
  const [step, setStep] = useState<'primary' | 'fallback' | 'none'>('primary');

  const uri =
    !urls || step === 'none'
      ? null
      : step === 'primary'
        ? urls.primary
        : urls.fallback;

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 6 }}
      className="items-center justify-center overflow-hidden bg-white/10"
    >
      {/* Las iniciales van SIEMPRE debajo: son el placeholder de carga y el
          último recurso, sin necesidad de un estado de "cargando". */}
      <Text
        style={{ fontSize: size / 2.8 }}
        className="font-bold text-white"
        numberOfLines={1}
      >
        {clubInitials(name)}
      </Text>

      {uri ? (
        <Image
          source={{ uri, cache: 'force-cache' }}
          style={{ position: 'absolute', width: size, height: size }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          // El redimensionado del servidor es una capacidad del plan de Storage,
          // no del esquema. Si dejara de servirse, se cae al original antes que
          // a las iniciales: mejor 913 KB que ningún escudo.
          onError={() => setStep(step === 'primary' ? 'fallback' : 'none')}
        />
      ) : null}
    </View>
  );
}
