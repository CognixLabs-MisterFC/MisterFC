# ADR-0022 — RevenueCat como capa de suscripción, y el antídoto contra la resurrección

- **Status**: Accepted
- **Date**: 2026-09-11
- **Revisiones**: 2026-09-11 — Jose cambia la decisión 5: **el periodo de gracia de la tienda sí da acceso** (ver «Revisiones» al final)
- **Deciders**: Iker Milla, Jose
- **Related**: [ADR-0021 — el borrado es anonimización](./ADR-0021-anonimizacion-forzada-por-el-esquema.md) · [BC.0 §8 — hueco reservado de la suscripción](../specs/BC.0-borrado-de-cuenta.md) · [ADR-0008 — patrón de crons en Vercel](./ADR-0008-vercel-cron-patron-jobs.md) · migración `20261058000000_bc1_account_deletion_model` (`entitlement_suspended_at`)

## Context

MisterFC deja de ser app de pago único (2,99 €) y pasa a ser **gratuita en las dos tiendas con
suscripción dentro de la app: 3 € al año**. Las decisiones de producto están tomadas y no se
reinterpretan aquí: paga cada **familia** (tutores y seguidores); cuerpo técnico, coordinación y
dirección no pagan; **sin suscripción no se ve nada** —ni lectura parcial ni prueba gratuita—; la
suscripción es **por cuenta, no por club**; vale en **las dos tiendas** porque el estado vive en el
servidor; y **el periodo de gracia de la tienda da acceso**. Jose confirma **cero ventas** en ambas
tiendas: no hay transición que gestionar ni compradores a los que indemnizar.

La integración directa contra las dos tiendas obliga a hablar dos protocolos que no se parecen en
nada: App Store Server Notifications v2 con payloads JWS y clave `.p8`, y Google Play Real-Time
Developer Notifications sobre Pub/Sub con cuenta de servicio, más la cadena
`purchaseToken → linkedPurchaseToken` para seguir una suscripción a través de renovaciones y cambios
de plan. Son tres PRs de infraestructura de pagos antes de cobrar el primer euro.

**Se evaluó RevenueCat.** Es gratis hasta 2.500 $ de ingresos mensuales registrados; a 3 €/año con un
club piloto, ese techo está lejísimos. El coste no es el factor: lo que pesa es **no escribir esa
infraestructura**.

La pregunta que había que contestar antes de decidir no era de precio. ADR-0021 estableció que borrar
una cuenta en MisterFC es **anonimización irreversible**, y BC.0 §8 ya advertía de que un «Restaurar
compras» con el mismo Apple ID podría **resucitar una cuenta borrada**: un incidente de privacidad, no
un bug. RevenueCat tiene **su propio identificador de usuario** (App User ID), **su propio concepto de
alias** y **su propio restaurar compras**. Si esa capa puede reenganchar una compra a una cuenta que
hemos anonimizado, el antídoto no vale.

Se revisó su documentación viva antes de decidir. El hallazgo relevante es que el comportamiento del
restaurar es un ajuste **de proyecto entero**, con cuatro modos:

| Modo | Qué hace |
| --- | --- |
| **Transfer to new App User ID** (por defecto) | Transfiere la compra al App User ID nuevo. Solo uno tiene acceso a la vez |
| Transfer if there are no active subscriptions | Igual, salvo que haya una suscripción activa |
| Keep with original App User ID | Devuelve `receipt_already_in_use`. Solo para apps que exigen cuenta antes de comprar |
| **Share between App User IDs** (legacy) | **Fusiona (alias)** los App User IDs que restauran la misma suscripción y los trata como **un mismo cliente** en adelante |

El cuarto modo es exactamente la resurrección que ADR-0021 prohíbe, elevada a comportamiento de
plataforma. El resto de la decisión se construye alrededor de mantenerlo apagado.

## Decision

**Se adopta RevenueCat como única capa de suscripción, con el App User ID atado a nuestra identidad y
el antídoto de la anonimización reconstruido en cuatro piezas.**

### 1 · Identidad

El **App User ID es `profiles.id`**: un UUID opaco. Ni email, ni nombre, ni identificador de club.
Nunca se usa el App User ID anónimo que genera el SDK para un usuario ya autenticado.

### 2 · Comportamiento del restaurar

Se usa el modo **por defecto, «Transfer to new App User ID»**.

> **«Share between App User IDs» queda PROHIBIDO.** Fusiona identidades y las trata como un mismo
> cliente: es la resurrección que ADR-0021 existe para impedir. Además **es irreversible**: una vez se
> abandona el modo alias no se puede volver a él, así que ni siquiera cabe el argumento de «se prueba
> y se revierte».

Se descarta «Keep with original App User ID» pese a que formalmente encajamos —el alta en MisterFC es
solo por invitación, todo el mundo tiene cuenta antes de comprar—: dejaría tirado a quien borre su
cuenta y sea reinvitado después, con la suscripción atrapada en el App User ID viejo y un
`receipt_already_in_use` habiendo pagado. Transferir no debilita el antídoto: lo que impedimos es
transferir **hacia** una cuenta borrada, no desde ella.

### 3 · Minimización de datos

RevenueCat pasa a ser **encargado de tratamiento**; MisterFC es el responsable. Se firma su DPA y se
añade a la política de privacidad. Lo que reciben, con esta configuración:

| Dato | ¿Llega? |
| --- | --- |
| App User ID (`profiles.id`) | Sí — un UUID opaco |
| Compra: producto, precio, moneda, país, tienda, entorno, fechas | Sí |
| Dirección IP | Sí |
| IDFV (iOS) / Advertising ID (Android) | **No** — `collectDeviceIdentifiers` queda desactivado |
| Subscriber attributes (email, nombre, cualquier otro) | **No** — no se envía ninguno |
| Cualquier dato de un **menor** | **Ninguno, nunca** |

La última fila es la que importa en esta app y es verdad **por construcción**, no por promesa: el
suscriptor es siempre el adulto, y lo único que sale de aquí es un UUID y una compra. Ni el nombre del
jugador, ni su ficha, ni sus datos de salud, ni sus consentimientos tocan RevenueCat en ningún momento.
Esa frase debe aparecer literalmente en `privacidad.md`.

En App Store Connect se declara **Purchases**, más *Analytics* y *App Functionality*.

### 4 · El antídoto contra la resurrección, en cuatro piezas

1. **Configuración** — el modo alias apagado (punto 2). Sin esto, lo demás no sirve.
2. **Dispositivo** — la nativa llama a **`logOut()` del SDK** en el camino de borrado, junto al
   `signOut()` de Supabase que ya existe en
   [`delete-account-card.tsx:99`](../../apps/native/src/ui/delete-account-card.tsx). Si no se hace, el
   SDK **conserva cacheado el App User ID de la cuenta borrada** y el siguiente «restaurar compras» en
   ese móvil vuelve a asociar la compra al perfil anonimizado. El agujero está dentro de nuestra app,
   no en su capa.
3. **Servidor** — al rematar el borrado se **elimina el cliente en RevenueCat** por su API REST, que
   solo admite la *secret key* desde servidor. RevenueCat declara que borrar un cliente elimina todos
   sus datos y es suficiente para una solicitud de supresión del RGPD. Es el **tercer efecto
   service-role** de la cadena de `finalize_account_deletion`, junto al borrado del avatar en Storage y
   la neutralización de GoTrue (BC-3). Como es una llamada HTTP, **no puede vivir dentro de la
   transacción de Postgres**: se encola y la ejecuta el servidor, con reintento.
4. **Cable trampa** — las tres piezas anteriores son código, y el código se rompe. El webhook
   `TRANSFER` trae `transferred_from` y `transferred_to`. Se comprueba en cada uno que el destino **no**
   sea un perfil con `deleted_at`, y si alguna vez lo es se registra y **salta una alerta**. Convierte
   un incidente de privacidad invisible en un evento de Sentry.

Con las cuatro puestas, la secuencia queda cerrada: tras el borrado nadie puede autenticarse como ese
perfil —GoTrue lo baneó en BC-3—, luego nada vuelve a presentar ese App User ID; el cliente ya no existe
en RevenueCat; y si el mismo Apple ID restaura más tarde, la compra **se transfiere a la cuenta nueva**.

### 5 · Seguimos teniendo tabla propia de entitlement

No basta con preguntarles a ellos. Tres razones que no son de gusto:

1. **El gate web se renderiza en el servidor.** `apps/web/src/app/[locale]/(authenticated)/layout.tsx`
   es un Server Component sin `'use client'`: ahí no hay SDK móvil. Sin estado local, cada render
   autenticado sería una llamada a su API.
2. **Si RevenueCat cae, el gate tiene que saber responder.** Sus entitlements offline son del lado del
   cliente; no cubren un Server Component.
3. **El antídoto y la auditoría necesitan una fila nuestra**, con su marca de desenganche y su
   historial.

Pero cambia de naturaleza: deja de ser un parseo de recibos de dos tiendas y pasa a ser una
**proyección de la verdad de RevenueCat**.

> **Esto deroga el punto 2 de BC.0 §8**, que exigía como clave el identificador de la tienda
> (`original_transaction_id` / purchase token). Esa clave existía para seguir una suscripción a través
> de las dos tiendas, y **ese problema lo resuelve RevenueCat**. La clave pasa a ser **`profile_id`**
> —una suscripción por cuenta, coherente con la decisión de producto—, con `store`,
> `store_transaction_id` y el identificador de cliente de RevenueCat guardados como **atributos**, para
> reconciliación y soporte, no como clave. La FK a `profiles` se mantiene `on delete no action`: la fila
> sobrevive a la anonimización y el desenganche es una **escritura explícita**, nunca un efecto lateral.
> El hueco `account_deletion_requests.entitlement_suspended_at` que BC-1 reservó es donde se sella.

### 6 · Qué sigue siendo nuestro

**La idempotencia no desaparece.** RevenueCat entrega con semántica *at least once*, reintenta hasta
5 veces (5, 10, 20, 40 y 80 minutos), **avisa explícitamente de que un mismo evento puede llegar más de
una vez** y no garantiza el orden. Así que siguen siendo nuestros el **libro de eventos** con
deduplicación por el `id` del webhook y la regla de **aplicar solo si es más nuevo**. Lo que sí
desaparece es hablar dos protocolos: un endpoint, una firma HMAC-SHA256, un formato.

**La reconciliación se encoge, no se va.** Tras cinco entregas fallidas **dejan de notificar**: un corte
nuestro de unas horas significa eventos perdidos para siempre. El trabajo nocturno deja de ser
«reconcilia contra dos APIs» y pasa a ser «pregunta por REST a RevenueCat por las cuentas cuyo
entitlement está a punto de vencer o lleva demasiado sin tocarse», con el patrón de ADR-0008.

**El gate lee `isActive`, pero hay una fecha que hay que guardarse aparte.** RevenueCat calcula
`isActive` **en servidor**, teniendo en cuenta la gracia, el account hold, la cancelación con tiempo
restante y el vencimiento. Los dos estados que importan salen bien sin lógica nuestra:

| Estado | ¿Acceso? | `isActive` |
| --- | --- | --- |
| Gracia (Apple `GRACE_PERIOD`, Google `IN_GRACE_PERIOD`) | **Sí**, por decisión de producto | `true` |
| Account hold de Google (`ON_HOLD`) | **No** — Google ya revocó el acceso y pone `expiryTime` en el pasado | `false` |

Luego **`ON_HOLD` no necesita tratamiento aparte en el gate**: `isActive` ya vale `false`, que es lo
correcto. Lo necesita en **cómo se entera nuestra tabla**, que es otra cosa:

> **Google no manda ningún evento en la transición gracia → account hold.** RevenueCat envía
> `EXPIRATION` **al final** del account hold, que con la política de Google vigente desde diciembre de
> 2025 dura **60 días menos la gracia configurada** (con 7 días de gracia, 53 de hold). Una proyección
> alimentada solo por webhooks seguiría diciendo «activo» casi dos meses después de que Google le
> hubiera quitado el acceso a esa persona.

La nativa no lo nota, porque lee `isActive` en vivo. **El gate web sí lo notaría**: es un Server
Component y lee nuestra tabla. Sin arreglo, alguien con la tarjeta caducada quedaría bloqueado en el
móvil y seguiría entrando por navegador durante semanas.

El arreglo es barato y no toca la decisión de producto: **`BILLING_ISSUE` sí llega en el acto** y trae
`grace_period_expiration_at_ms`. Se guarda, y la fecha de corte es el **máximo** entre el vencimiento
normal y esa. (En la primera redacción de este ADR puse «mínimo»; es un error mío, corregido al
escribir SU-1: `expiration_at_ms` y `grace_period_expiration_at_ms` son campos **distintos** del
webhook, así que en un impago el primero ya ha pasado y con el mínimo la gracia no daría ni un día de
acceso. Medido: con `least` el corte cae dos días **antes** de ahora.) La gracia sigue dando acceso; el hold corta el día que toca, sin depender de un webhook
que no va a llegar. La reconciliación de SU-6 prioriza las cuentas con `billing_issue_detected_at`
puesto, que son el único sitio donde la verdad puede divergir durante semanas.

**Las dos tiendas no se comportan igual y no se puede asumir simetría.** Apple **sí** avisa: manda
`GRACE_PERIOD_EXPIRED` al acabar la gracia —diciendo literalmente que ya se puede dejar de dar
servicio— y reserva `EXPIRED` para después de sus 60 días de billing retry. Google no manda nada
equivalente. El agujero es solo de Google, pero la regla de guardarse la fecha de fin de gracia vale
para las dos y es una regla sola.

**Un webhook de una cuenta borrada se registra pero no se aplica.** BC.0 §8 punto 4 lo pedía: las
renovaciones y los reembolsos van a seguir llegando para cuentas anonimizadas y no deben romper nada ni
resucitar nada. Se anota en el libro de eventos y no toca el entitlement.

## Consequences

- **Positivas**
  - Se eliminan tres PRs de infraestructura de pagos y dos integraciones de tienda que nadie de este
    equipo mantendría con gusto. La serie pasa de 8 PRs a 7.
  - Desaparece el problema del identificador estable de Google (`linkedPurchaseToken`), que era la pieza
    de diseño con más riesgo de escribirse mal.
  - El antídoto de ADR-0021 sale **más fuerte** que en el diseño directo: además del desenganche local
    hay un borrado real en el procesador y un cable trampa que avisa si algo falla.
  - A RevenueCat le llega menos dato personal del que le llegaría por defecto, y **cero dato de menores**.
  - Con la gracia dando acceso, la **nativa se simplifica de verdad**: lee `isActive` y no mantiene
    ninguna lógica de vencimiento propia.

- **Negativas**
  - Un procesador más en la política de privacidad, que gestiona datos de menores y **acaba de
    rehacerse**. Mitigante de calendario: el texto legal ya está parado esperando al abogado por la
    serie BC, así que esto entra en la **misma revisión** en lugar de provocar una segunda.
  - Dependencia de un tercero para el cobro. El techo de 2.500 $/mes de ingresos registrados está muy
    lejos con un club piloto, pero es una puerta que habrá que mirar si el producto crece.
  - `react-native-purchases` lleva código nativo: hace falta **build nuevo**, no basta con recompilar
    JS. El proyecto no usa `expo-updates`, así que esto **no introduce una restricción nueva** —cada
    versión nativa ya es un build—, pero sí ata SU-4 al ciclo de EAS.
  - **La razón del cambio de la decisión 5 solo es cierta a medias, y conviene no olvidarlo.** «Leer
    `isActive` en vez de mantener lógica propia de vencimiento» vale para la **nativa**. El **gate web**
    sigue necesitando una fecha en nuestra tabla, porque el webhook de la transición gracia → hold no
    existe en Google. El cambio simplifica un lado y no el otro.
  - **Apple no permite dos suscripciones al mismo producto bajo el mismo Apple ID.** Dos progenitores
    que comparten Apple ID en un móvil familiar **no pueden suscribirse los dos**, y con el modo de
    transferencia el segundo restaurar movería la compra y dejaría al primero sin acceso. Jose mantiene
    «cada cuenta paga la suya» sabiendo la limitación; **Family Sharing queda anotado como salida** si
    el caso aparece de verdad, porque es configuración del producto, no arquitectura.

- **Neutras**
  - El reparto de responsabilidades queda claro: RevenueCat es la **verdad** del estado de compra;
    nuestra tabla es la **proyección** que el gate lee. Si algún día se saliera de RevenueCat, lo que
    hay que reescribir es el ingestor, no el gate.
  - Jose sigue teniendo que dar de alta **los productos de suscripción en las dos tiendas**: eso
    RevenueCat no lo crea. Lo que ya no hace falta es Pub/Sub, cuenta de servicio de Play ni clave `.p8`.

## Revisiones

### 2026-09-11 — el periodo de gracia de la tienda sí da acceso

La versión original de este ADR (PR #575) recogía la decisión de producto **«sin periodo de gracia»**:
se bloqueaba en cuanto la suscripción no estuviera pagada, aunque la tienda siguiera reintentando. Al
escribir el ADR apareció que eso obligaba a **no** usar `isActive` —RevenueCat mantiene el entitlement
activo durante la gracia— y a sostener lógica de vencimiento propia en los dos clientes.

Jose cambia la decisión a la vista de ese hallazgo: **la gracia da acceso**. Motivos: menos código y
menos sitios donde equivocarse, y que alguien con la tarjeta caducada no se quede fuera mientras la
tienda todavía lo cuenta como suscriptor. `DID_FAIL_TO_RENEW` de Apple e `IN_GRACE_PERIOD` de Google
dejan de bloquear; vuelve `grace` como estado que da acceso.

Lo que la revisión **no** cambia: el account hold de Google (`ON_HOLD`) **no es gracia**, y sigue
bloqueando. Lo que sí añade es la obligación de guardarse `grace_period_expiration_at_ms` del evento
`BILLING_ISSUE`, porque Google no avisa de esa transición. Está desarrollado en la sección 6.
