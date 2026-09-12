# SU-7 · Fichas de tienda de la suscripción

> **Qué es esto**: lo que hay que rellenar en **App Store Connect** y en **Play Console**
> para que el producto de suscripción exista y se pueda revisar, con los textos ya
> escritos y contados. Lo pega el operador (Jose); aquí no hay nada que programar.
>
> Los límites de caracteres están contrastados contra la documentación viva de las dos
> tiendas al escribir esto, y **cada texto lleva su recuento** para que nadie descubra en
> el formulario que no cabe. Los límites son **por idioma**.

## 0 · Lo primero: la app deja de ser de pago

MisterFC se vendía a 2,99 €. Con la suscripción pasa a ser **gratuita con compra
integrada**, y eso hay que cambiarlo en los dos sitios:

| Tienda | Qué se cambia |
|---|---|
| App Store Connect | Precio de la app → **Free**. En la ficha aparecerá «In-App Purchases». |
| Play Console | La app ya era gratuita; se activa el producto de suscripción. |

Jose confirmó en SU-0 que **no hay ventas previas en ninguna de las dos tiendas**, así que
no hay transición que gestionar: nadie ha pagado los 2,99 € y nadie se queda con derechos
adquiridos. Si eso dejara de ser cierto antes de publicar, hay que volver sobre ello —
Apple prohíbe quitar a quien ya pagó la funcionalidad que compró (Guideline 3.1.2 a).

---

## 1 · App Store Connect

### Producto

| Campo | Valor |
|---|---|
| Tipo | Auto-Renewable Subscription |
| Grupo de suscripción (Reference Name) | `MisterFC acceso` |
| Product ID | `com.misterfc.app.suscripcion.anual` |
| Duración | 1 año |
| Precio (España) | 3 € · el resto de países, el equivalente que proponga Apple |
| Periodo de prueba | **ninguno** (decisión 3 de Jose) |

> El Product ID tiene que ser **exactamente** ese: es el que lleva cableado
> `ANNUAL_PRODUCT_ID` en `apps/native/src/subscription/purchases.ts`, y el que espera el
> *offering* `default_misterfc` de RevenueCat con el entitlement `PREMIUM`.

### Textos localizados

Apple exige **al menos una localización** con nombre y descripción antes de poder enviar
el producto a revisión. Límites: **nombre 30** caracteres, **descripción 45**.

| Idioma | Campo | Texto | Caracteres |
|---|---|---|---|
| es-ES | Display Name | `Acceso anual MisterFC` | 21 / 30 |
| es-ES | Description | `Acceso un año a la información del equipo` | 41 / 45 |
| en-US | Display Name | `MisterFC Annual Access` | 22 / 30 |
| en-US | Description | `One year of access to your team's info` | 38 / 45 |

> **Valenciano**: la app tiene `va`, pero App Store Connect no ofrece valenciano. Lo más
> cercano es **catalán (ca)**, que sí existe en las dos tiendas. **Decisión de Jose**: o se
> añade `ca` con el texto valenciano, o los usuarios de `va` verán la ficha en español. No
> lo decido yo: es cómo se llama públicamente el idioma, y eso aquí no es un detalle
> técnico.

### Campos de la app que ahora son obligatorios

| Campo | Valor |
|---|---|
| Privacy Policy URL | `https://misterfc.es/es/legal/privacidad` |
| EULA / Terms of Use | `https://misterfc.es/es/legal/terminos` (campo *License Agreement* o, en su defecto, enlazado en la descripción) |

Los dos hacen falta porque su documentación dice que «your app **and App Store metadata**
must include links to your Terms of Use and Privacy Policy». Los enlaces dentro del
binario ya están (SU-7 los añadió al muro); estos son los de la ficha.

### App Privacy (el cuestionario)

Con la suscripción aparecen dos tipos de datos nuevos. Lo que hay que declarar, según lo
que trata RevenueCat —su propia política: identificador de usuario, recibo de Apple, tipo
de dispositivo y sistema operativo—:

| Tipo de dato | Recogido | Vinculado a la identidad | Finalidad |
|---|---|---|---|
| Purchases → Purchase History | Sí | Sí | App Functionality |
| Identifiers → User ID | Sí | Sí | App Functionality |

**No** se declara *Tracking*: no hay identificadores publicitarios (no se llama a
`collectDeviceIdentifiers`) ni atribución, así que no aplica ATT ni hace falta el diálogo
de seguimiento.

---

## 2 · Play Console

| Campo | Valor |
|---|---|
| Producto | Subscription |
| Subscription ID | `com.misterfc.app.suscripcion.anual` |
| Base plan | auto-renovable, **P1Y** |
| Precio (España) | 3 € |
| Periodo de gracia | el que Play ofrezca por defecto — **importante**: la gracia **da acceso** (revisión de ADR-0022), y cuanta más gracia, menos *account hold* |

Textos. Límites: **nombre 55**, **descripción 80**, **hasta 4 beneficios de 40** cada uno.

| Idioma | Campo | Texto | Caracteres |
|---|---|---|---|
| es-ES | Nombre | `Acceso anual a MisterFC` | 23 / 55 |
| es-ES | Descripción | `Acceso durante un año a la información del equipo de tu hijo o hija.` | 68 / 80 |
| en-US | Nombre | `MisterFC annual access` | 22 / 55 |
| en-US | Descripción | `One year of access to your child's team information.` | 52 / 80 |

Beneficios (es-ES): `Calendario y convocatorias` (26) · `Asistencia y alineaciones` (25) ·
`Mensajes y anuncios del club` (28) · `Seguimiento deportivo` (21).

Beneficios (en-US): `Schedule and call-ups` (21) · `Attendance and line-ups` (23) ·
`Club messages and announcements` (31) · `Development tracking` (20).

### Data Safety (el cuestionario de Play)

| Tipo de dato | Recogido | Compartido | Finalidad |
|---|---|---|---|
| Financial info → Purchase history | Sí | No (va a un proveedor que actúa por nuestra cuenta) | App functionality |
| App activity / Other IDs → User ID | Sí | No | App functionality |

Y dos casillas que ya deberían estar marcadas desde BC: los datos van **cifrados en
tránsito** y existe una **forma de pedir el borrado** (Perfil → Eliminar mi cuenta, y
`https://misterfc.es/es/legal/eliminacion-cuenta`).

> **Play no está configurado todavía.** Mientras falte
> `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `canPurchase()` es false en Android y el muro lo
> dice en vez de ofrecer un botón muerto. El interruptor del cobro **no se enciende hasta
> que las dos tiendas puedan cobrar** — si no, una familia con Android se queda fuera sin
> forma de pagar.

---

## 3 · RevenueCat

| Qué | Valor |
|---|---|
| Entitlement | `PREMIUM` (en mayúsculas, exacto) |
| Offering | `default_misterfc` |
| Producto | `com.misterfc.app.suscripcion.anual`, en las dos tiendas |
| Webhook | `https://misterfc.es/api/webhooks/revenuecat`, con firma HMAC |
| Restore behavior | **Transfer to new App User ID** (el de por defecto) |
| «Share between App User IDs» | **PROHIBIDO** — ADR-0022 §2. Es irreversible |
| Subscriber attributes | ninguno |
| `collectDeviceIdentifiers` | no se llama |
| DPA | **pendiente de firma** — ver abajo |

---

## 4 · Antes de encender el cobro

Por orden de quién bloquea a quién:

- [ ] **Aviso a los clubes con 30 días de antelación** si el abogado califica a RevenueCat
      como subencargado. Lo exige nuestro propio contrato de encargo (§7.2) y **se mide en
      días de calendario**: es lo único de toda la serie que no se puede acelerar. Ver
      [la propuesta legal, decisión 〔6〕](../specs/SU.7-legal-suscripcion-propuesta.md).
- [ ] **DPA de RevenueCat firmado** (`revenuecat.com/dpa`) y guardado con el resto de
      contratos de encargo.
- [ ] **Texto legal aprobado** por el abogado y publicado
      ([propuesta](../specs/SU.7-legal-suscripcion-propuesta.md)): Términos con la sección
      de suscripción, Privacidad con RevenueCat, y el contrato de encargo con la fila
      nueva.
- [ ] **Lo del menor, al abogado** (decisión 〔3〕): Jose ya decidió el fondo —el menor con
      cuenta propia paga, sin excepción ni acceso derivado—, así que no hay código que
      cambiar. Queda que el abogado mire la autorización parental que exigen las tiendas.
- [x] **El revisor de Apple puede comprar** — resuelto en SU-8 (migración
      `20261066000000`, aplicada) y SU-8b. **Pero la lista nace vacía**: hay que meter el
      perfil del revisor antes de enviar, ver
      [apple-review-notes.md](apple-review-notes.md) §7.3.
- [ ] Productos creados y **aprobados** en las dos tiendas.
- [ ] `REVENUECAT_WEBHOOK_SECRET` y `REVENUECAT_SECRET_KEY` en Vercel.
- [ ] `EXPO_PUBLIC_REVENUECAT_IOS_KEY` y `_ANDROID_KEY` en EAS.
- [ ] Webhook registrado en RevenueCat y probado (un evento de sandbox debe quedar en
      `subscription_events` con `skipped_reason = 'sandbox'`: eso prueba que llega, que se
      verifica la firma y que no aplica).
- [ ] Precio de la app a **Free** en App Store Connect.
- [ ] Y al final, los dos interruptores **a la vez**: `SUBSCRIPTION_GATE=on` en Vercel y
      `EXPO_PUBLIC_SUBSCRIPTION_GATE=on` en el build de EAS. Encender solo uno deja la web
      y la app diciendo cosas distintas a la misma familia.
