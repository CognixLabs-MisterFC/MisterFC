import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ROUTE_SEGMENTS,
  SUBSCRIPTION_EXEMPT_SEGMENTS,
  isPublicRoute,
  isSubscriptionExemptRoute,
} from './config';

/**
 * Rutas públicas del guard de sesión.
 *
 * Lo que se protege aquí es el fallo que dejó la app en blanco: el guard expulsa
 * al login toda ruta que no sea pública, así que una ruta que se pinta sin sesión
 * y NO está en la lista entra en bucle con el login — sin excepción, sin crash y
 * sin evento en Sentry. Es un fallo mudo, y por eso conviene que algo lo mire.
 */
describe('isPublicRoute', () => {
  it('el login es público', () => {
    expect(isPublicRoute(['login'])).toBe(true);
  });

  it('el selector de club es público', () => {
    // La que faltaba. Sin esto, el login redirige al selector y el guard lo
    // devuelve al login: bucle infinito y pantalla en blanco.
    expect(isPublicRoute(['seleccionar-club'])).toBe(true);
  });

  it('las áreas con sesión NO son públicas', () => {
    for (const area of ['family', 'staff', 'direction', 'spectator']) {
      expect(isPublicRoute([area])).toBe(false);
    }
  });

  it('una subruta de una pública también lo es', () => {
    // El guard mira `segments[0]`: si mañana el selector tiene un segundo nivel,
    // no hay que volver a tocar la lista.
    expect(isPublicRoute(['seleccionar-club', 'lo-que-sea'])).toBe(true);
  });

  it('la raíz NO es pública', () => {
    // `segments` vacío = `/`, donde vive el gatekeeper, que ya redirige solo.
    expect(isPublicRoute([])).toBe(false);
  });

  it('una ruta inventada no es pública', () => {
    expect(isPublicRoute(['ruta-que-no-existe'])).toBe(false);
  });
});

describe('la lista de rutas públicas apunta a rutas REALES', () => {
  // Una errata en la lista ('seleccionar_club' con guion bajo, por ejemplo) no
  // da error de compilación ni de lint: deja la ruta fuera y devuelve la pantalla
  // en blanco. Aquí se comprueba contra el árbol de ficheros de expo-router.
  it.each([...PUBLIC_ROUTE_SEGMENTS])('«%s» existe en app/', (segment) => {
    const appDir = join(__dirname, '..', '..', 'app');
    const comoFichero = join(appDir, `${segment}.tsx`);
    const comoCarpeta = join(appDir, segment);
    const existe =
      existsSync(comoFichero) ||
      (existsSync(comoCarpeta) && statSync(comoCarpeta).isDirectory());
    expect(existe).toBe(true);
  });
});

/**
 * SU-4 — rutas exentas del MURO DE PAGO.
 *
 * Mismo fallo mudo que las públicas, una vuelta más arriba: si el muro empuja a
 * `/suscripcion` una ruta que no está exenta, y `/suscripcion` tampoco lo está, el
 * guard se redirige a sí mismo. Un bucle de navegación no lanza excepciones: la app se
 * queda en blanco, sin crash, sin Sentry y sin CI en rojo.
 */
describe('isSubscriptionExemptRoute', () => {
  it('el muro está exento de sí mismo (si no, es un bucle)', () => {
    expect(isSubscriptionExemptRoute(['suscripcion'])).toBe(true);
  });

  it('la confirmación del borrado está exenta', () => {
    expect(isSubscriptionExemptRoute(['cuenta-eliminada'])).toBe(true);
  });

  it.each(['login', 'seleccionar-club'])('%s está exenta: nunca se empuja hacia atrás a quien entra', (seg) => {
    expect(isSubscriptionExemptRoute([seg])).toBe(true);
  });

  it('la raíz está exenta: ahí decide el gatekeeper', () => {
    expect(isSubscriptionExemptRoute([])).toBe(true);
  });

  // Decisión 3 de Jose: sin suscripción no se ve NADA del producto.
  it.each(['family', 'staff', 'direction', 'spectator'])('el área %s NO está exenta', (seg) => {
    expect(isSubscriptionExemptRoute([seg])).toBe(false);
  });

  // Y `perfil` tampoco: exentarlo abriría media app de familia. El borrado sigue
  // alcanzable porque su tarjeta vive DENTRO de la pantalla del muro.
  it('perfil NO está exento', () => {
    expect(isSubscriptionExemptRoute(['family', 'perfil'])).toBe(false);
    expect(isSubscriptionExemptRoute(['perfil'])).toBe(false);
  });

  it('cuenta por SEGMENTO de primer nivel, como el guard', () => {
    expect(isSubscriptionExemptRoute(['suscripcion', 'loquesea'])).toBe(true);
  });

  // Toda ruta exenta tiene que ser un fichero de verdad: una entrada que no exista es
  // una exención que no protege nada.
  it('cada segmento exento existe como ruta', () => {
    const appDir = join(process.cwd(), 'app');
    for (const seg of SUBSCRIPTION_EXEMPT_SEGMENTS) {
      const asFile = join(appDir, `${seg}.tsx`);
      const asDir = join(appDir, seg);
      const ok =
        (existsSync(asFile) && statSync(asFile).isFile()) ||
        (existsSync(asDir) && statSync(asDir).isDirectory());
      expect(ok, `falta la ruta ${seg}`).toBe(true);
    }
  });
});
