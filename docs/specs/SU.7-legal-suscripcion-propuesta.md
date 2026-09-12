# SU-7 · Propuesta de texto legal — suscripción y RevenueCat

> **ESTO NO ESTÁ PUBLICADO.** Es una propuesta. Los textos vivos siguen siendo
> `apps/web/src/content/legal/terminos.md` y `.../privacidad.md`. Nada de este fichero se
> sirve.
>
> **Doble aprobación**, igual que en [BC.8](BC.8-legal-eliminacion-cuenta-propuesta.md):
> Jose decide el fondo y un abogado revisa la forma. Aquí hay más motivo que nunca para
> lo segundo: es la primera vez que MisterFC **cobra a una persona física**, y eso mete en
> juego normativa de consumo (desistimiento, renovación automática, información
> precontractual) y una **transferencia internacional nueva**.
>
> Las decisiones que **no** puedo tomar yo están en el §5, numeradas.

---

## 0 · Una corrección a lo que dije en SU-0

En SU-0 resumí que RevenueCat recibe «solo un UUID y una compra». Eso describe **lo que
configura nuestro SDK**, y sigue siendo cierto: no llamamos a `collectDeviceIdentifiers`,
no mandamos ni un *subscriber attribute*, y el App User ID es `profiles.id`, un UUID
opaco (comprobado de nuevo al escribir esto: en `purchases.ts` no hay ninguna llamada de
atributos ni de identificadores).

Pero una política de privacidad no describe lo que configuramos, sino **lo que el
encargado trata**. Y su propia política dice que trata, además:

| Categoría | Lo que dice su política |
|---|---|
| Información técnica | tipo de dispositivo, sistema operativo |
| Datos de transacción | *last seen time*, fichero de recibo de Apple, *purchase token* de Google |
| Opcional | *User ID* y datos de atribución **cuando el desarrollador los activa** (nosotros: solo el User ID) |

Y algo que cambia la sección de transferencias: **aloja los datos en AWS en Estados
Unidos**. Su política no menciona dirección IP ni identificadores publicitarios.

Así que el texto propuesto abajo dice *esto*, no mi resumen de SU-0.

## 1 · Por qué hay que cambiar los dos documentos

Los textos vivos se escribieron cuando la app era de pago único en la tienda y **nadie
pagaba nada dentro**. Hoy dicen cosas que dejan de ser ciertas el día que se enciende el
cobro:

| Dice hoy | Realidad con la suscripción |
|---|---|
| Términos §3: «La relación deportiva, **económica** y disciplinaria del usuario es **con su club**, no con Cognix Labs, S.L.» | Falso a partir de ahora para las familias y los seguidores: pagan 3 €/año **a Cognix Labs**, a través de la tienda. Sigue siendo cierto para todo lo demás (cuotas, fichas, disciplina), y conviene que el texto distinga las dos cosas en vez de borrar la frase. |
| Términos §2: lista lo que hace la Plataforma, sin una palabra de precio | Las tiendas **exigen** informar de precio, periodicidad y renovación automática antes de comprar. |
| Términos §10 (duración): el acceso acaba por baja, revocación o incumplimiento | Falta la causa nueva y la más frecuente: **no renovar la suscripción**. |
| Privacidad §8: tabla de encargados sin RevenueCat | RevenueCat es encargado desde el momento en que alguien se suscribe. |
| Privacidad §9: las transferencias fuera del EEE son push (Google/Apple) y CDN (Vercel/Cloudflare) | RevenueCat aloja en **AWS Estados Unidos**. Es una transferencia nueva, y no es de un CDN: es el registro de quién ha pagado. |
| Privacidad §10 (conservación): nada sobre datos de pago | Al borrar la cuenta se pide la supresión del cliente en RevenueCat (BC/SU-3), pero **la tienda conserva su propio histórico de compra**, que no es nuestro. |

---

## 2 · Términos y Condiciones · sección NUEVA

> Va después de la §2 (Objeto) y renumera el resto. El texto propuesto no dice el precio
> como cifra cerrada, y es a propósito: ver decisión **〔4〕**.

```markdown
## 3. Suscripción de acceso

La aplicación MisterFC es de **descarga gratuita**. El acceso del personal del club
(dirección, coordinación y cuerpo técnico) está incluido en el servicio que el club
contrata y no tiene coste para esas personas.

El acceso de las **familias y de los seguidores** requiere una **suscripción anual de
pago**, que se contrata a título personal:

- **Qué incluye.** Acceso a la información del jugador o jugadores vinculados a la
  cuenta: equipo, calendario, convocatorias, asistencia, alineaciones, seguimiento
  deportivo, mensajes y anuncios del club, y las funciones de la aplicación
  correspondientes al perfil del usuario.
- **Duración y precio.** La suscripción tiene una duración de **un (1) año** desde su
  contratación. El precio aplicable es el que muestra la tienda de aplicaciones en el
  momento de la compra, impuestos incluidos.
- **Renovación automática.** La suscripción **se renueva automáticamente** por periodos
  iguales de un año, al precio vigente en cada renovación, salvo que el usuario la
  cancele con una antelación mínima de **24 horas** respecto de la fecha de renovación.
- **Cómo cancelarla.** La cancelación se realiza desde la **cuenta de la tienda de
  aplicaciones** (Apple App Store o Google Play), no desde MisterFC. Cancelar impide la
  siguiente renovación; el acceso se mantiene hasta el final del periodo ya pagado.
- **Dónde se contrata.** La suscripción **solo puede contratarse desde la aplicación
  móvil**. No existe pago a través del sitio web. Una vez contratada, el acceso funciona
  también en la versión web: la suscripción es de la cuenta del usuario, no del
  dispositivo.
- **Cobro y devoluciones.** El cobro lo realiza la tienda de aplicaciones a través de la
  cuenta del usuario, conforme a sus propias condiciones. Las solicitudes de devolución
  se dirigen a la tienda, que es quien gestiona el pago.
- **Una cuenta, una suscripción.** La suscripción va asociada a la cuenta de usuario de
  MisterFC, no al club: si el usuario pertenece a varios clubes, una sola suscripción le
  da acceso a todos. Cada cuenta requiere su propia suscripción, incluso cuando dos
  personas pertenezcan a la misma familia.
- **Impago.** Si la renovación no puede cobrarse, la tienda abre un periodo de reintentos
  durante el cual el acceso se mantiene. Agotado ese periodo sin cobro, el acceso queda
  suspendido hasta que se regularice, sin que ello suponga la eliminación de la cuenta ni
  de la información del club.
- **Cambios de precio.** Cualquier modificación del precio se comunicará con la
  antelación y por los medios que exija la tienda de aplicaciones, y no se aplicará a un
  periodo ya pagado. El usuario podrá cancelar antes de que surta efecto.

Eliminar la cuenta de MisterFC **no cancela la suscripción**: la suscripción vive en la
cuenta de la tienda y debe cancelarse allí. Esta advertencia se muestra también dentro de
la aplicación, en el propio proceso de eliminación.
```

### Parches a dos secciones que hoy dicen otra cosa

```markdown
## 4. Relación entre el usuario, el club y Cognix Labs

[…] En consecuencia:

- La relación **deportiva y disciplinaria** del usuario es **con su club**, no con
  Cognix Labs, S.L. Lo mismo ocurre con las **cuotas, fichas y cualquier otro pago
  propio de la actividad deportiva**, que el club gestiona por sus propios medios y son
  ajenos a la Plataforma.
- La **suscripción de acceso** regulada en la sección 3 es la **única** relación
  económica entre el usuario y Cognix Labs, S.L., y es independiente de lo que el usuario
  pague o deba a su club. Impagar la cuota del club no afecta a la suscripción, y
  cancelar la suscripción no extingue ninguna obligación con el club.
```

```markdown
## 11. Duración y terminación

El acceso puede finalizar cuando:

- el usuario solicita la eliminación de su cuenta;
- **la suscripción de acceso vence y no se renueva, o su cobro no puede completarse**;
- el club revoca el acceso del usuario o finaliza su vinculación;
- el club deja de utilizar la Plataforma;
- Cognix Labs, S.L. suspende el acceso por incumplimiento grave de estos Términos.

La pérdida de acceso por falta de suscripción **no elimina** la cuenta ni la información
del jugador: el acceso se restablece al reactivar la suscripción.
```

---

## 3 · Política de Privacidad · RevenueCat

### 3.1 · Fila nueva en la tabla de la §8 (Destinatarios y subencargados)

```markdown
| RevenueCat | Gestión técnica de las suscripciones de pago: validación de la compra con la tienda de aplicaciones y registro del estado de la suscripción. | Estados Unidos |
```

### 3.2 · Párrafo de alcance, junto a los que ya existen para Sentry y para las notificaciones

> Redactado a partir de **su propia política**, no de lo que nosotros configuramos.

```markdown
**Alcance de los datos enviados a RevenueCat.** A este proveedor se transmite únicamente
un **identificador interno de la cuenta** —un código aleatorio que no contiene el nombre,
el correo electrónico ni ningún otro dato personal—, la información de la compra
facilitada por la tienda de aplicaciones (producto, fechas, identificador de la
transacción y comprobante o justificante de compra) y datos técnicos básicos del
dispositivo, como su tipo y sistema operativo. **No se transmite ningún dato de los
jugadores**, ni datos de salud, ni contenido de mensajes, ni imágenes, ni la dirección de
correo electrónico. La aplicación no envía a este proveedor identificadores publicitarios
del dispositivo ni datos de atribución de campañas. La información sobre quién ha pagado
la suscripción no se comunica al club.
```

### 3.3 · Añadido a la §9 (Transferencias internacionales)

```markdown
La gestión técnica de las suscripciones de pago se realiza en servidores situados en
**Estados Unidos**. Dicha transferencia se ampara en las garantías previstas en el
Capítulo V del RGPD.
```

### 3.4 · Añadido a la §10 (Conservación)

```markdown
**Datos de la suscripción.** Al eliminar la cuenta se solicita la supresión de los datos
de la suscripción al proveedor que la gestiona técnicamente. El **histórico de compra que
conserva la tienda de aplicaciones** (Apple App Store o Google Play) no depende de
Cognix Labs, S.L.: está sujeto a las condiciones y a los plazos de conservación de la
tienda, y debe reclamarse ante ella.
```

### 3.5 · El contrato con los clubes, que es el que tiene un plazo

`Documentos/misterfc-contrato-encargo-tratamiento.md` §7 lleva una **lista cerrada de
subencargados autorizados**, y su §7.2 dice esto:

> El Encargado informará al Club de cualquier incorporación o sustitución de
> subencargados con una antelación mínima de **treinta (30) días**, durante los cuales el
> Club podrá oponerse por motivos razonables.

Si RevenueCat entra en esa lista, **el aviso de 30 días es un requisito del calendario de
lanzamiento**, no un trámite posterior: el interruptor del cobro no puede encenderse antes
de que pase ese plazo desde el aviso a los clubes. Lo apunto aquí y en la lista de
comprobación de las fichas de tienda porque es lo único de SU-7 que **se mide en días de
calendario** y no depende de nosotros.

---

## 4 · Lo que las tiendas exigen en la pantalla de compra: auditoría

Contrastado contra la documentación viva de Apple (Guideline 3.1.2 y la página de
suscripciones, que dice literalmente que «your app and App Store metadata **must include
links to your Terms of Use and Privacy Policy**») y contra la política de suscripciones
de Google Play.

| Requisito | Estado antes de SU-7 | Dónde vive |
|---|---|---|
| Nombre y duración de la suscripción | ✅ | título del producto de la tienda + `subscription.per_year` |
| Qué se obtiene durante el periodo | ✅ | `subscription.body` |
| **Precio completo**, bien visible y localizado | ✅ | `pkg.product.priceString`, el de la tienda. Nunca un literal nuestro: un «3 €» escrito a mano sería falso en cuanto cambie el país o la divisa |
| Que se renueva automáticamente y cómo cancelar | ✅ | `subscription.terms_note` |
| Forma de **restaurar** la compra | ✅ | botón «Restaurar compras» (Guideline 3.1.1) |
| **Enlace a las condiciones de uso** | ❌ **faltaba** | arreglado en este PR |
| **Enlace a la política de privacidad** | ❌ **faltaba** | arreglado en este PR |

Los dos enlaces que faltaban **no son copy, son el permiso para cobrar**: una suscripción
auto-renovable sin ellos en el binario es un rechazo por 3.1.2. Se han añadido a los dos
muros (nativa y web) con un censo que lo vigila, porque la app **no tenía ni un enlace
legal** en ninguna pantalla: `/legal/*` existía solo en la web desde #453.

---

## 5 · Decisiones que no me corresponden

**〔1〕 Derecho de desistimiento.** Es una suscripción a un servicio digital contratada a
distancia. Hay que decidir qué se dice: que la tienda informa y gestiona el desistimiento
conforme a sus condiciones, o incluir cláusula propia con la renuncia informada del
art. 103.m TRLGDCU. Mi propuesta no lo regula; solo dice que las devoluciones se piden a
la tienda, que es un hecho.

**〔2〕 Quién vende.** Apple y Google actúan como intermediarios en el cobro, con figuras
distintas según el país (agente o revendedor). Lo he redactado como «el cobro lo realiza
la tienda conforme a sus propias condiciones», sin calificar la figura jurídica. Si el
abogado quiere nombrarla, es su terreno.

**〔3〕 UN MENOR PUEDE SER QUIEN PAGUE. Medido en producción hoy, no es hipotético.**

`requires_subscription` (definición viva, leída de producción al escribir esto) exige
suscripción a quien tenga un vínculo en `player_accounts` **con cualquier relación,
incluida `self`**, o una `membership` con rol `jugador`. Es decir: **la cuenta propia de
un jugador paga**.

| Medido en producción | |
|---|---|
| Vínculos `player_accounts` | 7 |
| …de ellos con `relation = 'self'` | **1** |
| …y ese jugador es **menor de 18** | **sí** |
| `memberships` con rol `jugador` vivas | 5 |
| Jugadores menores de 18 / total | 40 / 40 |

Dos consecuencias:

1. **Se le pediría a un menor que contrate y pague.** Las tiendas exigen que quien compra
   sea el titular de la cuenta y mayor de edad (o que medie autorización parental), y un
   contrato con un menor es anulable.
2. **«Cero datos de menores» deja de ser cierto** en el sentido estricto: el
   identificador que viaja a RevenueCat sería el de la cuenta de un menor. Sigue siendo
   un UUID opaco y sin PII, pero es un dato personal referido a un menor tratado en
   Estados Unidos, y eso el abogado tiene que saberlo.

Lo que propongo —y es decisión de Jose, no mía—: **eximir la cuenta propia del jugador**
cuando el jugador sea menor, porque su familia ya paga por el tutor. Eso es un cambio de
`requires_subscription`, o sea **SQL y una migración**: no entra en SU-7.

**〔4〕 El precio, en el texto.** He evitado escribir «3 €» en los Términos a propósito: el
precio lo fija la tienda por país y divisa, y un número en un documento legal se queda
desfasado sin que nadie lo toque. El texto remite al precio que muestra la tienda. Si
Jose quiere la cifra, la fórmula segura es «3 € al año en España; en otros países, el
precio equivalente que muestre la tienda».

**〔5〕 Qué pasa con el acceso de un seguidor cuando paga la familia.** Hoy padre, madre y
cada seguidor pagan por separado (decisión 8 de Jose). El texto lo dice con claridad
(«Cada cuenta requiere su propia suscripción, incluso cuando dos personas pertenezcan a
la misma familia») porque es lo que más reclamaciones va a generar y tiene que estar
escrito antes, no después.

**〔6〕 ¿Es RevenueCat subencargado de los datos del club, o encargado nuestro?** Hay dos
lecturas y la diferencia cuesta 30 días:

- **No lo es.** La suscripción es una relación entre Cognix Labs y la familia, en la que
  Cognix es **responsable**, no encargado del club. Los datos deportivos del jugador no
  viajan a RevenueCat. Bajo esta lectura, la §7 del contrato con los clubes no se toca.
- **Sí lo es.** El identificador que viaja es `profiles.id`, el mismo que identifica al
  usuario dentro del club, y —según la decisión 〔3〕— puede ser el de un menor que es
  sujeto de los datos del club.

**Mi recomendación es tratarlo como subencargado y avisar a los clubes**, porque el coste
de acertar es un correo y 30 días de calendario, y el de equivocarse es un incumplimiento
contractual con todos los clubes a la vez. Pero es una calificación jurídica, y la firma
la pone el abogado.

---

## 6 · Al aprobarse

1. El texto de los §2 y §3 se lleva a `Documentos/misterfc-terminos-condiciones.md` y
   `Documentos/misterfc-politica-privacidad.md` (los vivos), y se copia **verbatim** a
   `apps/web/src/content/legal/terminos.md` y `.../privacidad.md`. El `diff` entre cada
   par tiene que quedar **vacío**: es la comprobación que se hizo en BC-8.
2. Se añade RevenueCat a la tabla de subencargados del
   `Documentos/misterfc-contrato-encargo-tratamiento.md` **y se avisa a los clubes con 30
   días de antelación** (decisión 〔6〕).
3. Se actualiza la fecha de «Última actualización» de los dos.
4. Se revisa si el cambio obliga a **re-consentimiento** (F14-5 tiene el mecanismo):
   un cambio de Términos que introduce un pago no es un cambio menor.
5. Se marca la casilla correspondiente en
   [apple-review-notes.md](../journey/apple-review-notes.md) y en
   [su7-fichas-tienda.md](../journey/su7-fichas-tienda.md).
