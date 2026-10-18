# Notas de versión · 1.0.2

> **Qué es esto**: el texto de «Novedades» que se pega en **App Store Connect** y en
> **Play Console** al enviar la 1.0.2, en los tres idiomas de la app. Lo pega el
> operador (Jose); aquí no hay nada que programar. Hermano de
> [su7-fichas-tienda.md](su7-fichas-tienda.md), y con la misma regla: **cada texto lleva
> su recuento**, para que nadie descubra en el formulario que no cabe.

| Tienda | Campo | Límite por idioma |
|---|---|---|
| App Store Connect | *What's New in This Version* | 4.000 |
| Play Console | *Novedades / What's new* | **500** |

**Un solo texto por idioma, para las dos tiendas.** Manda el límite de Play, que es
ocho veces más estrecho, y los tres caben de sobra dentro de él. Dos redacciones
distintas para lo mismo se desincronizan en el segundo envío, y eso cuesta más que los
caracteres que sobran en Apple.

## Qué cambió de verdad, y por qué esto es lo que se cuenta

El binario publicado es del **2026-10-07** (iOS build 10 · Android código 7, los dos
con el nombre de versión 1.0.1), así que en la 1.0.2 entra todo lo de once días, no
solo lo de la última tarde. Lo que se cuenta es lo que **se nota al usar la app**:

| Se cuenta | De dónde sale |
|---|---|
| El reloj aparece y el partido se empieza desde la app | #828 (y #801, que comprueba la alineación antes) |
| Las listas de cambio dicen quién está en el campo AHORA | #829 — salían de la alineación oficial, y un cambio mal apuntado estropea los minutos de toda la plantilla |
| El penalti se apunta en el momento; el resto, a un toque | #830, sobre los diez tipos de #815 |
| El acta entera se carga desde el móvil al acabar | #816 |
| La ficha del jugador, a un toque desde la plantilla | #826 |
| Los avisos de gol llegan antes | #809, #810, #811 |

**Lo que NO se cuenta, a propósito**: la médica y las notas del jugador (#827) y el
autogol (#819) solo los ve el cuerpo técnico, y la ficha de la tienda la leen sobre
todo padres y madres. En Apple sobran 3.500 caracteres si algún día se quieren añadir.

---

## Castellano · `es` · 455 caracteres

```
El directo, más fácil de llevar desde el móvil:

• El reloj ya aparece siempre: el partido se empieza desde la app.
• Al hacer un cambio, las listas muestran quién está de verdad en el campo, no la alineación inicial.
• Los penaltis se apuntan en el momento, como los goles; el resto de jugadas, en un toque más.
• Al acabar, el acta entera se carga desde el móvil.
• La ficha del jugador, a un toque desde la plantilla.

Y los avisos de gol llegan antes.
```

## Valencià · `va` · 436 caracteres

```
El directe, més fàcil de portar des del mòbil:

• El rellotge ja apareix sempre: el partit es comença des de l'app.
• Quan fas un canvi, les llistes mostren qui està de veritat al camp, no l'alineació inicial.
• Els penals s'apunten al moment, com els gols; la resta de jugades, a un toc més.
• En acabar, l'acta sencera es carrega des del mòbil.
• La fitxa del jugador, a un toc des de la plantilla.

I els avisos de gol arriben abans.
```

## English · `en` · 464 caracteres

```
Running a live match from your phone is easier:

• The clock is always there now, so the match can be started from the app.
• When you make a substitution, the lists show who is really on the pitch, not the starting line-up.
• Penalties are recorded as they happen, like goals; everything else is one tap away.
• At full time, the whole match sheet is filed from your phone.
• A player's profile is one tap away from the squad list.

Goal alerts arrive sooner too.
```
