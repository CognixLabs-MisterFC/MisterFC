import { PaywallScreen } from '@/subscription/paywall';

/**
 * SU-4 — ruta del muro de pago. El segmento `suscripcion` está en
 * `SUBSCRIPTION_EXEMPT_SEGMENTS` (nav/config): si no, el guard se redirigiría a sí
 * mismo y la app se quedaría en blanco sin lanzar ninguna excepción.
 *
 * NO es una ruta pública: exige sesión. Quien no la tiene lo rebota `SessionGuard`.
 */
export default function SuscripcionRoute() {
  return <PaywallScreen />;
}
