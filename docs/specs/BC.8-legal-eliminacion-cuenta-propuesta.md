# BC-8 · Propuesta de texto legal — eliminación de cuenta

> **ESTO NO ESTÁ PUBLICADO.** Es una propuesta. El texto vivo sigue siendo
> `Documentos/misterfc-eliminacion-cuenta.md`, del que
> `apps/web/src/content/legal/eliminacion-cuenta.md` es copia verbatim (comprobado:
> `diff` vacío). Nada de este fichero se sirve.
>
> **Doble aprobación.** Jose decide el fondo; pero el texto vivo lo revisó un abogado
> y esta propuesta **no la ha revisado nadie con esa formación**. Antes de publicar
> debería pasar por el mismo filtro, sobre todo las dos justificaciones nuevas (bases
> de conservación de mensajes y de consentimientos).

## Por qué hace falta cambiarlo

El texto vivo se escribió antes de la serie BC y hoy **dice cosas que ya no son
ciertas**:

| Dice hoy | Realidad tras BC-1…BC-7 |
|---|---|
| Que la eliminación se pide **por correo** a `info.cognixlabs@gmail.com` | Se pide **desde la app**, en Perfil. Es justo lo que exige Apple (Guideline 5.1.1 v) y lo que la revisión va a comprobar. |
| "plazo máximo de un mes desde su recepción" | Plazo **duro de 30 días**, y el acceso cae **en el acto**. |
| "se suprimen… dirección de correo electrónico y credenciales" | No se borra la fila: el correo se **sustituye** por uno no enrutable y la contraseña por una aleatoria, y la cuenta queda bloqueada. El efecto para la persona es el mismo, pero el texto no debería decir "se suprime" lo que se sustituye. |
| Nada sobre los mensajes | **Se conservan con su contenido** (decisión 4 de Jose). |
| Nada sobre `ip` / `user_agent` de los consentimientos | **Se conservan** (decisión 3). |
| Sobre el histórico deportivo, solo habla del caso de la supresión del jugador | Al borrar la cuenta del **tutor**, la ficha del jugador **no se toca**: el histórico sigue **con su nombre** (decisión 5). |

Las cuatro cosas que Jose pidió que aparezcan explícitamente están marcadas abajo con
**〔1〕〔2〕〔3〕〔4〕**.

---

## Texto propuesto · `eliminacion-cuenta.md`

> Sustituye el fichero entero. Lo que no se toca se reproduce igual para que se pueda
> leer de corrido.

```markdown
# Eliminación de cuenta — MisterFC

Última actualización: [FECHA DE APROBACIÓN]

En MisterFC puedes eliminar tu cuenta y tus datos personales en cualquier momento,
**desde la propia aplicación**. Esta página explica cómo hacerlo y qué ocurre con la
información.

MisterFC es una plataforma que utilizan clubes deportivos para gestionar sus equipos.
**El responsable de los datos deportivos es el club** al que perteneces; Cognix Labs,
S.L. presta el servicio tecnológico por cuenta de dicho club. Por eso hay información
que no desaparece al eliminar tu cuenta: no es tuya, es del club.

## Cómo eliminar tu cuenta

1. Abre **MisterFC** (aplicación móvil o versión web) e inicia sesión.
2. Ve a **Perfil**.
3. Al final de la pantalla, pulsa **Eliminar mi cuenta**.
4. Lee el resumen de lo que se elimina y lo que se conserva, escribe **ELIMINAR** para
   confirmar y pulsa el botón.

No hace falta escribir a nadie ni esperar a que nadie te autorice.

Si prefieres hacerlo por escrito, también puedes solicitarlo en
**info.cognixlabs@gmail.com** desde la dirección con la que te registraste.

Si la cuenta es de un jugador menor de edad, la eliminación debe pedirla su padre,
madre o tutor legal.

## Qué ocurre desde el momento en que lo pides

**〔1〕** En cuanto confirmas, y sin esperar a nada:

- **pierdes el acceso** a todos tus clubes y equipos;
- **dejan de enviarse notificaciones** a tus dispositivos, y se borran los
  identificadores de dispositivo y tus preferencias de aviso.

A partir de ahí pueden ocurrir dos cosas:

- **Si no eres el único tutor de ningún jugador**, la cuenta se elimina **en ese mismo
  momento** y ya no puedes volver a entrar.
- **Si eres el único tutor de algún jugador**, la misma pulsación inicia la supresión
  de los datos de ese jugador, que el club debe resolver por ser su responsable.
  **Tu cuenta se elimina en cuanto el club resuelva y, en todo caso, en un plazo
  máximo de 30 días naturales desde tu solicitud**, decida lo que decida el club o
  aunque no decida nada.

Mientras tanto puedes entrar solo para **cancelar** la eliminación, y al cancelarla
recuperas el acceso que tenías.

## Qué se elimina

- Tu nombre y apellidos, tu fotografía de perfil, tu teléfono y tu fecha de nacimiento.
- Tu correo electrónico deja de estar asociado a la cuenta: se sustituye por una
  dirección interna que no corresponde a ningún buzón, la contraseña se reemplaza por
  una aleatoria y la cuenta queda bloqueada. **No puedes volver a acceder, ni
  recuperar la contraseña, ni registrarte de nuevo con esa misma cuenta.**
- Tu vinculación con el club, con los equipos y con los jugadores.
- Tus identificadores de dispositivo, tus preferencias de notificación y tus avisos.

Donde antes aparecía tu nombre, la aplicación muestra **"Usuario eliminado"**.

## Qué se conserva, y por qué

**〔2〕 Los mensajes, con su contenido.** Los mensajes que escribiste al club, a un
equipo o a otras familias, así como los anuncios que publicaste, **se conservan tal
como los escribiste**, pero dejan de estar asociados a tu nombre: figuran como escritos
por un usuario eliminado. Son conversaciones de las que forman parte otras personas, y
borrar unilateralmente una de las voces dejaría el historial del club mutilado e
ininteligible para quienes siguen en él. Su conservación responde al interés legítimo
del club en mantener el registro íntegro de sus comunicaciones internas.

**〔3〕 Los consentimientos que otorgaste o revocaste.** El registro de consentimientos
**no se modifica en absoluto**, y eso incluye **la dirección IP y el navegador o
aplicación** desde los que se otorgó o se retiró cada uno. Ese registro es precisamente
la prueba de que el consentimiento existió, de su alcance y del momento en que se dio o
se retiró; suprimirlo destruiría la única evidencia de un hecho que la normativa obliga
a poder acreditar (artículos 5.2 y 7.1 del RGPD). Por el mismo motivo el registro es de
solo añadido: no se edita ni se borra.

**〔4〕 El historial deportivo del jugador, con su nombre.** Eliminar tu cuenta **no
elimina la ficha del jugador ni su historial**. Convocatorias, asistencias,
alineaciones, estadísticas, valoraciones e informes siguen existiendo **con el nombre
del jugador**, porque son datos de un titular distinto del tuyo y de los que el club es
responsable: los necesita para la gestión deportiva, federativa y de seguros. Si además
quieres que se supriman los datos del jugador, es una solicitud aparte —descrita más
abajo— que el club debe resolver.

**El trabajo registrado en la plataforma, si eras personal del club.** Sesiones,
ejercicios, jugadas, convocatorias, alineaciones, registros de asistencia, valoraciones
e informes son datos de gestión deportiva del club y permanecen en él, atribuidos a un
usuario eliminado.

**Los registros de auditoría.** La plataforma mantiene un registro de los accesos y
operaciones realizados sobre información sensible. No se suprimen: constituyen la prueba
de dichos accesos y de la propia ejecución de las supresiones. Se conservan mientras el
club permanezca dado de alta y se utilizan exclusivamente con fines de seguridad y de
acreditación del cumplimiento normativo.

**Los datos sujetos a obligaciones legales**, bloqueados durante los plazos legalmente
exigibles.

MisterFC no procesa cobros ni almacena datos bancarios, por lo que no se conserva
información de facturación de los usuarios.

## Los datos del jugador son una solicitud aparte

**La eliminación de la cuenta de un padre, madre o tutor no elimina por sí sola la
ficha del jugador.** El jugador sigue perteneciendo al club.

Si quieres que se supriman sus datos, puedes pedirlo desde la aplicación:

1. Abre **MisterFC** e inicia sesión con tu cuenta de familia.
2. Ve a la sección de **gestión del jugador**.
3. Solicita la **supresión de datos** del jugador.

La solicitud se traslada al administrador o al director del club, que debe resolverla.
Una vez aprobada:

- se eliminan de forma permanente la fotografía del jugador y sus datos médicos;
- se ocultan sus apellidos y el resto de datos identificativos, de modo que el jugador
  deja de ser identificable en la aplicación y su ficha queda inaccesible;
- se conserva el histórico deportivo del equipo sin permitir la identificación del
  jugador.

Si eres el **único** tutor del jugador, esta solicitud se genera automáticamente al
eliminar tu cuenta, sin que tengas que hacer nada más.

También puedes solicitarla escribiendo a **info.cognixlabs@gmail.com** o directamente a
tu club.

## Otros derechos

Además de la eliminación, puedes ejercer los derechos de acceso, rectificación,
limitación, oposición y portabilidad, así como retirar los consentimientos otorgados.

Desde la propia aplicación, en tu perfil, puedes en cualquier momento:

- consultar los consentimientos que has otorgado y su fecha;
- revocar cualquier consentimiento de forma inmediata;
- descargar una copia de los datos del jugador.

Puedes consultar el detalle de los tratamientos y de los plazos de conservación en
nuestra Política de Privacidad.

---

Cognix Labs, S.L.
Calle Actor Antonio Ferrandis, 10 — 46013 Valencia (España)
info.cognixlabs@gmail.com
```

---

## Añadidos propuestos a `privacidad.md`

La política de privacidad tiene su propio apartado de conservación y hoy no dice ninguna
de las dos cosas. Dos párrafos, para que los dos documentos no se contradigan.

**En el apartado de conservación**, junto al párrafo que ya existe sobre registros de
auditoría:

```markdown
**Eliminación de cuenta y comunicaciones.** La eliminación de una cuenta de usuario no
suprime los mensajes, anuncios y comunicaciones que esa persona hubiera enviado a través
de la plataforma. Su contenido se conserva, disociado de la identidad de quien lo
escribió, por ser parte de conversaciones en las que intervienen otras personas y del
registro de comunicaciones internas del club, responsable de dicho tratamiento.

**Eliminación de cuenta y registro de consentimientos.** El registro de consentimientos
y de sus revocaciones, incluida la dirección IP y el agente de usuario asociados a cada
uno, no se suprime al eliminar la cuenta: constituye la prueba exigible del
consentimiento y de su retirada conforme a los artículos 5.2 y 7.1 del RGPD.
```

## Lo que NO he tocado, a propósito

- **`terminos.md`** — no describe el ciclo de vida de la cuenta; no encontré nada que
  quede desmentido por la serie BC.
- **`Documentos/*.md`** — la propuesta tendría que copiarse ahí y a
  `apps/web/src/content/legal/` **a la vez**, para que el `diff` siga saliendo vacío.
- **La suscripción de 3 €/año** — Apple exige avisar de que borrar la cuenta no cancela
  la suscripción. El hueco de copy y las claves i18n están reservados y vacíos desde
  BC-4; cuando la suscripción exista, este texto también tendrá que decirlo.
