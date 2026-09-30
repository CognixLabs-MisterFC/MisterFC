import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-2 — la optimizacion de codigo en los builds de RELEASE (R8) y sus mappings.
 *
 * Play avisaba: «la optimizacion de codigo DEX esta por debajo de nuestro umbral»
 * —ofuscacion al 1 %, piden 25 %, limite febrero de 2027—. Se activa R8.
 *
 * TRES COSAS QUE ROMPEN EN SILENCIO, y por eso estan aqui:
 *
 *  1. EL NOMBRE DE LA PROPIEDAD. El build.gradle que genera el prebuild lee
 *     `android.enableMinifyInReleaseBuilds`. `build-apk.sh` pasaba el nombre VIEJO
 *     (`enableProguardInReleaseBuilds`), que ya no se lee: era un flag muerto que no
 *     desactivaba nada y solo parecia funcionar porque el defecto coincidia. Con R8
 *     activado, ese flag habria dejado que la QA local construyera CON minificacion,
 *     justo lo contrario de lo que promete.
 *
 *  2. LOS MAPPINGS DE SENTRY. R8 renombra las clases de Java/Kotlin. El plugin de
 *     Gradle de Sentry —el que sube el mapping para desofuscar— SOLO se aplica si se
 *     le pasa `experimental_android.enableAndroidGradlePlugin`; sin eso, medido en su
 *     codigo, no se aplica y las traces nativas llegan ilegibles. No se nota al
 *     compilar: se nota el dia que hay un crash nativo.
 *
 *  3. EL SHRINKING DE RECURSOS, que se deja FUERA a proposito. El aviso de Play es de
 *     codigo DEX, no de recursos, y quitar recursos por analisis estatico rompe cosas
 *     que solo se ven en ejecucion. Si alguien lo enciende, que sea una decision y no
 *     un arrastre de este cambio.
 *
 * El JS no se ve afectado: sus traces salen de sourcemaps, que R8 no toca. Lo que se
 * degradaria sin el punto 2 son los crashes de la parte nativa.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');

const appJson = JSON.parse(
  readFileSync(join(RAIZ, 'apps', 'native', 'app.json'), 'utf8'),
) as { expo: { plugins: (string | [string, Record<string, unknown>])[] } };

const BUILD_APK = readFileSync(join(RAIZ, 'apps', 'native', 'build-apk.sh'), 'utf8');

function opcionesDe(nombre: string): Record<string, unknown> | null {
  for (const p of appJson.expo.plugins) {
    if (Array.isArray(p) && p[0] === nombre) return p[1] ?? {};
    if (p === nombre) return {};
  }
  return null;
}

describe('D-2 · R8 activado en release', () => {
  it('expo-build-properties esta enchufado', () => {
    // Es el unico camino en un proyecto CNG: `android/` se genera, asi que tocar
    // gradle.properties a mano no sirve de nada.
    expect(opcionesDe('expo-build-properties')).not.toBeNull();
  });

  it('con la propiedad que el gradle SI lee', () => {
    const o = opcionesDe('expo-build-properties') as { android?: Record<string, unknown> };
    expect(o.android?.enableMinifyInReleaseBuilds).toBe(true);
  });

  it('y NO con el nombre viejo, que no se lee', () => {
    const o = opcionesDe('expo-build-properties') as { android?: Record<string, unknown> };
    expect(o.android).not.toHaveProperty('enableProguardInReleaseBuilds');
  });

  it('el shrinking de RECURSOS se queda fuera, a proposito', () => {
    const o = opcionesDe('expo-build-properties') as { android?: Record<string, unknown> };
    expect(o.android?.enableShrinkResourcesInReleaseBuilds ?? false).toBe(false);
  });
});

describe('D-2 · los mappings de ProGuard suben a Sentry', () => {
  it('el plugin de Gradle de Sentry esta pedido explicitamente', () => {
    // Sin esta opcion el plugin NO se aplica (medido en withSentry.js: la llamada
    // esta dentro de `if (props?.experimental_android?.enableAndroidGradlePlugin)`).
    const o = opcionesDe('@sentry/react-native') as {
      experimental_android?: Record<string, unknown>;
    };
    expect(o).not.toBeNull();
    expect(o.experimental_android?.enableAndroidGradlePlugin).toBe(true);
  });

  it('y sigue sabiendo a que proyecto de Sentry subirlos', () => {
    // Ancla positiva: si alguien reescribe el bloque y se lleva organization/project,
    // el plugin no puede subir nada y el test de arriba seguiria verde.
    const o = opcionesDe('@sentry/react-native') as Record<string, unknown>;
    expect(o.organization).toBe('mister-fc');
    expect(o.project).toBe('misterfc-native');
  });
});

describe('D-2 · la QA local sigue SIN minificar', () => {
  it('build-apk.sh usa el nombre de propiedad vigente', () => {
    expect(BUILD_APK).toContain('-Pandroid.enableMinifyInReleaseBuilds=false');
  });

  it('y ya no pasa el flag muerto', () => {
    // Este es el test que evita repetir el fallo: el nombre viejo no desactiva nada.
    expect(BUILD_APK).not.toContain('-Pandroid.enableProguardInReleaseBuilds');
  });

  it('el shrinking de recursos tambien sigue apagado en local', () => {
    expect(BUILD_APK).toContain('-Pandroid.enableShrinkResourcesInReleaseBuilds=false');
  });

  it('y queda escrito como reproducir el build minificado', () => {
    // Es la unica forma de probar R8 sin gastar un build de EAS; si la nota
    // desaparece, se pierde el unico camino documentado.
    expect(BUILD_APK).toContain('-Pandroid.enableMinifyInReleaseBuilds=true');
  });
});
