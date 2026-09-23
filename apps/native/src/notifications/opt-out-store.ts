import * as SecureStore from 'expo-secure-store';

/**
 * «No quiero push EN ESTE DISPOSITIVO», recordado localmente.
 *
 * Hace falta porque borrar el token no basta: `registerPushTokenIfPermitted` corre
 * en CADA login, y con el permiso de Android todavía concedido volvería a darlo de
 * alta. Sin este recuerdo, apagar las notificaciones duraría hasta la siguiente
 * sesión — que es justo la clase de ajuste que no se sostiene y hace que la gente
 * deje de fiarse de los interruptores.
 *
 * LOCAL y no en `profiles`, y es deliberado: la decisión es de ESTE aparato. Una
 * familia con tablet y móvil apaga el del salón y sigue recibiendo en el bolsillo.
 * Guardarlo en el servidor lo apagaría en los dos.
 *
 * Clave por usuario (norma: la key lleva el id del recurso) y con '.' de separador:
 * expo-secure-store rechaza ':'.
 */
const optOutKey = (userId: string) => `push_opt_out.${userId}`;

export async function isPushOptedOut(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(optOutKey(userId))) === '1';
  } catch {
    // Un fallo del almacén no puede dejar a nadie sin avisos: se asume que SÍ los
    // quiere, que es el estado por defecto y el que no sorprende.
    return false;
  }
}

export async function setPushOptedOut(userId: string, optedOut: boolean): Promise<void> {
  try {
    if (optedOut) await SecureStore.setItemAsync(optOutKey(userId), '1');
    else await SecureStore.deleteItemAsync(optOutKey(userId));
  } catch {
    // Silencio a propósito: quien llama ya ha borrado (o dado de alta) el token, que
    // es el efecto que cuenta hoy. Lo que se pierde es que la decisión aguante al
    // siguiente login.
  }
}
