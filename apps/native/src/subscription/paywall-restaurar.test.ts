import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El muro contra lo que Apple exige en la Guideline 3.1.2. Dos cosas que el typecheck
 * no ve y que ninguna prueba cubría:
 *
 *  1. RESTAURAR TIENE QUE SEGUIR AHÍ CUANDO NO HAY PRECIO. El botón vivía DENTRO de la
 *     rama `pkg` del condicional, así que desaparecía junto con el precio cuando el
 *     offering no cargaba —el SDK lanza, o la tienda no cotiza el producto—. Es el
 *     ÚNICO botón de restaurar de toda la app, así que quien ya había pagado,
 *     reinstalaba y se topaba con ese fallo se quedaba sin forma de recuperar su
 *     compra: exactamente el caso para el que Apple lo exige. Compilaba y pasaba todo.
 *
 *  2. EL AVISO DE RENOVACIÓN TIENE QUE LEERSE. Iba en `text-zinc-400`, 2,6:1 de
 *     contraste sobre blanco a 12 px, el texto más apagado de la pantalla siendo el que
 *     el revisor mira con más lupa. Bajar un tono es un cambio de una palabra que nadie
 *     nota en revisión de código.
 *
 * Se lee el fichero como TEXTO porque la suite nativa corre en Node, sin runtime de
 * React Native: no se puede montar la pantalla. Y se leen los comentarios FUERA, porque
 * este mismo fichero explica por qué no se usa `zinc-400` — y una aserción que casara
 * con su propia explicación no mediría nada.
 */
const PANTALLA_RUTA = join(__dirname, 'paywall.tsx');
const CRUDO = readFileSync(PANTALLA_RUTA, 'utf8');

/** Sin comentarios de bloque ni de línea: solo lo que se ejecuta. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CODIGO = sinComentarios(CRUDO);
/** Espacios colapsados: así el test sobrevive a que prettier recoloque las líneas. */
const COMPACTO = CODIGO.replace(/\s+/g, ' ');

/** El texto de la rama `pkg` del condicional: lo que solo se ve si hay algo que vender. */
function ramaDelPaquete(): string {
  const abre = CODIGO.indexOf(') : pkg ? (');
  expect(abre, 'la rama `pkg` del condicional ya no existe: revisa este test').toBeGreaterThan(-1);
  const cierra = CODIGO.indexOf('\n        ) : (', abre);
  expect(cierra, 'no se encuentra el cierre de la rama `pkg`').toBeGreaterThan(abre);
  return CODIGO.slice(abre, cierra);
}

/** El condicional de la oferta completo, desde `!sellable` hasta su `)}`. */
function bloqueDeLaOferta(): string {
  const abre = CODIGO.indexOf('{!sellable ? (');
  expect(abre, 'la rama `!sellable` ya no existe: revisa este test').toBeGreaterThan(-1);
  const cierra = CODIGO.indexOf('\n        )}', abre);
  expect(cierra, 'no se encuentra el cierre del condicional de la oferta').toBeGreaterThan(abre);
  return CODIGO.slice(abre, cierra);
}

/** La línea que pinta el aviso de renovación automática. */
function lineaDelAviso(): string {
  const lineas = CODIGO.split('\n').filter((l) => l.includes("t('terms_note')"));
  expect(lineas, 'el aviso de renovación no se pinta en ningún sitio').toHaveLength(1);
  return lineas[0]!;
}

describe('muro · el fichero se ha leído de verdad', () => {
  it('trae la pantalla y sus piezas conocidas', () => {
    // Ancla positiva de todo lo demás: si el fichero no se cargara, las ausencias de
    // más abajo pasarían solas y no afirmarían nada.
    expect(CODIGO.length).toBeGreaterThan(2000);
    expect(CODIGO).toContain('export function PaywallScreen()');
    expect(CODIGO).toContain("t('restore')");
    expect(CODIGO).toContain("t('terms_note')");
  });
});

describe('muro · restaurar compras sobrevive a que no haya precio', () => {
  it('hay un solo botón de restaurar', () => {
    const veces = COMPACTO.split('onPress={onRestore}').length - 1;
    expect(veces).toBe(1);
  });

  it('la rama del paquete SÍ trae el botón de comprar', () => {
    // Ancla positiva: confirma que `ramaDelPaquete()` recorta el trozo correcto antes
    // de afirmar que algo NO está dentro.
    const rama = ramaDelPaquete();
    expect(rama).toContain('onPress={onBuy}');
    expect(rama).toContain('priceString');
  });

  it('la rama del paquete NO trae el botón de restaurar', () => {
    expect(ramaDelPaquete()).not.toContain('onRestore');
  });

  it('restaurar se guarda con `sellable`, no con `pkg`', () => {
    // `sellable` es "el SDK está configurado", que es lo único que restaurar necesita.
    // Sin clave de plataforma, `Purchases` no está configurado y llamarlo lanzaría.
    expect(COMPACTO).toContain('{sellable ? ( <Pressable onPress={onRestore}');
  });

  it('restaurar no depende de que la consulta del precio haya terminado', () => {
    // Si volviera a mirar `loadingOffer`, una consulta colgada lo esconde otra vez.
    expect(COMPACTO).not.toContain('loadingOffer ? ( <Pressable onPress={onRestore}');
    expect(COMPACTO).not.toContain('sellable && !loadingOffer ? ( <Pressable onPress={onRestore}');
  });
});

describe('muro · el aviso de renovación se lee', () => {
  it('va en un tono con contraste suficiente', () => {
    // zinc-600 sobre blanco = 7,7:1. Se acepta 600 o más oscuro: oscurecerlo más
    // adelante está bien, aclararlo no.
    expect(lineaDelAviso()).toMatch(/text-zinc-(600|700|800|900)/);
  });

  it('no vuelve a un tono ilegible', () => {
    // zinc-400 daba 2,6:1 a 12 px. zinc-500, 4,7:1, tampoco basta para este texto.
    expect(lineaDelAviso()).not.toMatch(/text-zinc-(300|400|500)/);
  });

  it('el fichero ya no usa zinc-400 en ningún texto', () => {
    // Ancla positiva primero: el fichero sigue usando la escala de zinc, así que la
    // ausencia de `zinc-400` no es que hayan desaparecido las clases.
    expect(CODIGO).toContain('text-zinc-');
    expect(CODIGO).not.toContain('text-zinc-400');
  });
});

describe('muro · lo que Apple exige se pinta SIEMPRE', () => {
  it('el aviso de renovación no está dentro del condicional de la oferta', () => {
    const bloque = bloqueDeLaOferta();
    // Ancla positiva: el bloque recortado es el que se cree.
    expect(bloque).toContain("t('unavailable_platform')");
    expect(bloque).not.toContain('terms_note');
  });

  it('los enlaces legales tampoco', () => {
    const bloque = bloqueDeLaOferta();
    expect(bloque).not.toContain('terms_link');
    expect(bloque).not.toContain('privacy_link');
    expect(bloque).not.toContain('withdrawal_link');
    // Y están en la pantalla, que es la otra mitad de la afirmación.
    expect(CODIGO).toContain("t('terms_link')");
    expect(CODIGO).toContain("t('privacy_link')");
    expect(CODIGO).toContain("t('withdrawal_link')");
  });
});
