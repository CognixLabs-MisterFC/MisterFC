import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-1 — la app NO restringe la orientacion ni el redimensionamiento.
 *
 * Play lo pedia: «quita las restricciones de redimensionamiento y orientacion para
 * que sea compatible con pantallas grandes». Con `orientation: "portrait"`, el
 * manifest sale con `android:screenOrientation="portrait"` y en una tablet o en
 * pantalla partida la app queda en una franja vertical.
 *
 * MEDIDO con `expo prebuild`, con control negativo, antes de dar por bueno el cambio:
 *
 *     orientation: "portrait"  ->  android:screenOrientation="portrait"
 *     orientation: "default"   ->  android:screenOrientation="unspecified"
 *
 * POR QUE ESTO ES UN TEST Y NO UN COMENTARIO: volver a `"portrait"` es UNA palabra,
 * el aviso de Play reaparece al siguiente envio y nada falla por el camino. Y como
 * `android/` se genera y no se versiona, no hay ningun fichero en el repo donde se
 * vea la consecuencia — solo esta clave.
 *
 * `orientation` es de PRIMER NIVEL y no admite variante por plataforma (el esquema
 * solo acepta `default`, `portrait` y `landscape`), asi que gobierna Android Y iOS.
 * Es una decision tomada, no un descuido.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');

const appJson = JSON.parse(
  readFileSync(join(RAIZ, 'apps', 'native', 'app.json'), 'utf8'),
) as {
  expo: {
    orientation?: string;
    ios?: { requireFullScreen?: boolean };
    android?: Record<string, unknown>;
  };
};

describe('D-1 · pantallas grandes', () => {
  it('la orientacion NO esta bloqueada', () => {
    // `default` = sin bloqueo. Que la clave falte tambien valdria (es el defecto de
    // Expo), pero esta escrita a proposito para que se vea la decision.
    expect(appJson.expo.orientation).toBe('default');
  });

  it('ancla positiva: los valores que SI restringen son otros', () => {
    // Sin esto, un `toBe('default')` sobre una clave borrada por error pasaria a
    // `undefined` y el test de arriba fallaria — pero conviene dejar escrito cuales
    // son los valores prohibidos, que es lo que alguien podria volver a poner.
    expect(['portrait', 'landscape']).not.toContain(appJson.expo.orientation);
  });

  it('iOS no se re-restringe por la puerta de atras', () => {
    // `requireFullScreen: true` le quita a un iPad el multitarea, que es la misma
    // restriccion que acabamos de soltar, por otro camino.
    expect(appJson.expo.ios?.requireFullScreen ?? false).toBe(false);
  });

  it('Android no declara la restriccion por su cuenta', () => {
    // No existe `android.orientation` en el esquema de Expo, pero si alguien mete
    // una entrada suelta o un `resizeableActivity: false`, aqui se ve.
    const android = appJson.expo.android ?? {};
    expect(android).not.toHaveProperty('orientation');
    expect(android.resizeableActivity ?? true).toBe(true);
  });
});
