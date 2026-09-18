/**
 * El teclado no tapa el campo. Un solo sitio donde está decidido cómo.
 *
 * ── POR QUÉ NO ES EL KeyboardAvoidingView DE REACT NATIVE ──────────────────
 *
 * Ya estaba probado en dos pantallas —`login` e `invite/[token]`— y las dos lo
 * montaban así:
 *
 *     behavior={Platform.OS === 'ios' ? 'padding' : undefined}
 *
 * `undefined` en Android hace que el componente NO HAGA NADA. Jose prueba con el
 * APK, así que en Android no había ni una pantalla con manejo de teclado, y eso es
 * exactamente lo que vio: la contraseña de acceso y el cuadro de mensaje tapados.
 *
 * Montar un wrapper sobre esa misma pieza sería arreglar diecisiete sitios con la
 * herramienta que acabábamos de ver fallar. Así que la base es
 * `react-native-keyboard-controller`, que se comporta igual en las dos plataformas
 * porque escucha al teclado de verdad en vez de depender del `adjustResize` de
 * Android.
 *
 * ── LAS TRES FORMAS QUE HAY EN ESTA APP ────────────────────────────────────
 *
 * Del censo salieron tres, y por eso hay tres componentes y no uno:
 *
 *   · `KeyboardScrollView` — pantalla con formulario dentro de un scroll. Es un
 *     reemplazo directo de `ScrollView`: acepta sus mismas props.
 *   · `KeyboardModalView`  — el cuadro centrado de un `<Modal>`, que no scrollea.
 *   · `KeyboardStickyBar`  — la barra de escribir anclada abajo (el chat), que no
 *     tiene que scrollear: tiene que SUBIR con el teclado.
 *
 * Meter las tres en un componente «que se adapte» significaría adivinar la forma
 * desde dentro. Son tres decisiones distintas y se eligen desde fuera.
 *
 * ── EL PROVIDER ────────────────────────────────────────────────────────────
 *
 * `KeyboardProvider` va UNA vez, en `app/_layout.tsx`. Sin él estos tres
 * componentes se montan sin error y no hacen nada — un fallo mudo. Por eso el guard
 * de CI comprueba también que el provider siga en el layout raíz.
 */
import { cssInterop } from 'nativewind';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import type { ComponentProps } from 'react';

/** Hueco entre el campo enfocado y el borde del teclado. Un dedo, no más. */
const BOTTOM_OFFSET = 16;

/**
 * NativeWind solo traduce `className` a `style` en los componentes que conoce, y los
 * de una librería de terceros no están en esa lista. Sin estas tres líneas,
 * `className="flex-1"` en un `KeyboardScrollView` se IGNORA en silencio: no hay
 * error, no hay aviso, simplemente la pantalla se descoloca. Y «se descoloca en
 * silencio» es justo el tipo de fallo que nos ha traído hasta aquí.
 *
 * Se registran una vez, al importar este módulo, que es el único sitio del proyecto
 * que toca estos componentes.
 */
cssInterop(KeyboardAwareScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});
cssInterop(KeyboardAvoidingView, { className: 'style' });
cssInterop(KeyboardStickyView, { className: 'style' });

/**
 * Reemplazo de `ScrollView` para cualquier pantalla con campos de texto. Acepta las
 * props de `ScrollView`, así que la sustitución es de una línea.
 *
 * `keyboardShouldPersistTaps="handled"` va de serie y no es un detalle: sin él, el
 * primer toque en un botón con el teclado abierto solo cierra el teclado, y el
 * usuario tiene que pulsar dos veces. Las pantallas que ya lo traían a mano lo
 * seguirán teniendo (las props explícitas ganan).
 */
export function KeyboardScrollView(
  props: ComponentProps<typeof KeyboardAwareScrollView>,
) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={BOTTOM_OFFSET}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
}

/**
 * Para el contenido de un `<Modal>`: el cuadro se aparta del teclado en vez de
 * quedarse debajo.
 *
 * `automaticOffset` deja que el componente mida dónde está en pantalla. Hace falta
 * justamente aquí: un modal no empieza donde empieza la pantalla, y sin esto habría
 * que ir pasando `keyboardVerticalOffset` a mano en cada uno —siete números que
 * nadie volvería a revisar.
 */
export function KeyboardModalView(
  props: ComponentProps<typeof KeyboardAvoidingView>,
) {
  return <KeyboardAvoidingView behavior="padding" automaticOffset {...props} />;
}

/**
 * Para la barra anclada abajo, como el cuadro de escribir del chat: sube con el
 * teclado y baja con él. No scrollea nada, y no debe: lo que está encima ya tiene
 * su propio scroll.
 */
export function KeyboardStickyBar(
  props: ComponentProps<typeof KeyboardStickyView>,
) {
  return <KeyboardStickyView {...props} />;
}
