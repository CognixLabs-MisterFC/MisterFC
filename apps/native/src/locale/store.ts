import * as SecureStore from 'expo-secure-store';

/**
 * Persistencia LOCAL del idioma elegido en expo-secure-store (ADR-0020: nada en
 * AsyncStorage). Sirve para que el arranque sea INSTANTÁNEO sin esperar a la red;
 * `profiles.locale` sigue siendo la fuente de verdad y gana cuando llega.
 *
 * CLAVE PROPIA con el userId (norma: la key lleva el id del recurso), para que cada
 * cuenta del dispositivo tenga su idioma. El valor es un código de 2 letras → cabe
 * de sobra en SecureStore, sin trocear.
 */
const localeKey = (userId: string) => `i18n_locale::${userId}`;

export async function getStoredLocale(userId: string): Promise<string | null> {
  return SecureStore.getItemAsync(localeKey(userId));
}

export async function setStoredLocale(userId: string, locale: string): Promise<void> {
  await SecureStore.setItemAsync(localeKey(userId), locale);
}

export async function clearStoredLocale(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(localeKey(userId));
}
