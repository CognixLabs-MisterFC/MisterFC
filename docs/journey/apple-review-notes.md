# Notas de revisión para Apple — borrado de cuenta y suscripción

> **Qué es esto**: lo que hay que pegar en *App Store Connect → App Review Information*
> y cómo dejar la cuenta de prueba en el estado correcto antes de enviar.
> **Por qué existe**: Apple bloqueó la publicación con la **Guideline 5.1.1(v)** — una app
> que da acceso a cuentas debe permitir **iniciar el borrado de la cuenta desde dentro de
> la app**. La serie BC lo construye; esto es lo que se le enseña al revisor.
>
> **SU-7 añade la segunda mitad**: con la suscripción, el revisor ya no solo tiene que
> poder borrarse — tiene que poder **comprar**. Eso es el §7, y hoy trae un **bloqueo**
> que hay que resolver antes de enviar.

## 1 · El camino que tiene que ver el revisor

```
Perfil  →  Eliminar mi cuenta  →  escribir ELIMINAR  →  Eliminar mi cuenta
        →  sesión cerrada  →  "Tu cuenta ha sido eliminada"
        →  volver a intentar entrar con las mismas credenciales → rebota
```

Ese último plano es el que cierra la revisión: no basta con enseñar el botón, hay que
enseñar que **la cuenta ya no entra**.

La tarjeta está al final de **Perfil**, en las cuatro áreas de la app (familia,
seguidor, cuerpo técnico y dirección) y también en la web.

## 2 · La cuenta de prueba

> **Dos papeles, una sola cuenta.** La cuenta que va en la ficha tiene que servir para
> las dos cosas que mira el revisor: **borrarse** (este apartado) y **comprar** (§7). Para
> lo segundo, además, su perfil tiene que estar designado en `subscription_test_profiles`,
> y la del envío de octubre de 2026 es `jovimib+apple@gmail.com` (§7.3, medido). Lo de
> abajo es el análisis de borrado, hecho sobre `familia1` el 2026-09-11; **el criterio es
> lo que vale, la cuenta se comprueba en el §7.3**.

La contraseña de cualquiera de estas cuentas es la constante `PASSWORD` de
[seed-test-accounts.mjs](../../apps/web/scripts/seed-test-accounts.mjs).

**El criterio** —lo que hay que cumplir, sea cual sea la cuenta que acabe en la ficha—
es **no ser único tutor de ningún jugador**. `familia1` lo cumplía: está vinculada a Jose
Milla, que tiene además a `jovimib+jugador1@gmail.com` como segunda cuenta. Sin
jugadores bloqueantes, el borrado **se completa entero y de forma síncrona** delante de
la cámara, sin depender de que ningún club apruebe nada.

Estado medido en producción el 2026-09-11:

| Cuenta | Clubes activos | Vínculos con jugador | **Bloqueantes** |
|---|---|---|---|
| `jovimib+familia1@gmail.com` | 1 | 1 | **0** ✅ |
| `jovimib+jugador1@gmail.com` | 1 | 1 | 0 |
| `jovimib+jugador2@gmail.com` | 1 | 2 | 2 ❌ |

**No usar `jugador2`**: es único tutor de dos jugadores, así que su borrado genera dos
solicitudes de supresión y se queda *pendiente* hasta que el club decida o pasen 30
días. Delante de la cámara se vería una pantalla de espera, no la confirmación.

## 3 · La cuenta es de UN SOLO USO

Al completarse, la cuenta queda **anonimizada y baneada**: el correo se sustituye por
uno no enrutable y la contraseña por una aleatoria. Eso es justo lo que Apple quiere
ver, y significa que **después del vídeo esa cuenta ya no sirve**.

Para recrearla:

```bash
cd apps/web && node scripts/seed-test-accounts.mjs
```

El script crea un usuario nuevo con el mismo correo (el viejo ya no lo ocupa, porque se
renombró a `deleted-<id>@deleted.invalid`).

> **Ojo**: hasta BC-8 este script **no podía crear cuentas nuevas**. Desde que F14D
> (#312) cerró el signup libre, `handle_new_user` exige `invitation_id` en user_metadata,
> `founder=true` en app_metadata, o una invitación pendiente — y el script no mandaba
> ninguna de las tres, así que fallaba con *"Database error creating new user"*. BC-8 lo
> arregla. Medido contra el proyecto real, con tres usuarios desechables creados y
> borrados:
>
> | Lo que manda el script | Resultado |
> |---|---|
> | nada (como estaba) | ✗ `Database error creating new user` |
> | `app_metadata.founder = true` | ✗ `Database error creating new user` |
> | `invitation_id` en `user_metadata` | ✓ creado |
>
> El escape del operador (`founder`) **no sirve por la Admin API**: GoTrue aplica
> `app_metadata` DESPUÉS del INSERT, así que el trigger lo lee vacío. Por SQL directo sí
> funciona, que es como lo usan las fixtures de pgTAP.

**Después de borrar `familia1`**, Jose Milla se queda con un solo tutor
(`jugador1`), así que **`jugador1` pasa a ser bloqueante**. Si hace falta repetir el
vídeo sin re-seedear, usar `familia1` recreada, nunca `jugador1`.

## 4 · Requisito del build

El APK/IPA tiene que llevar **`EXPO_PUBLIC_WEB_URL`** apuntando a la web desplegada: el
borrado pasa por un route handler de la web, y sin esa variable `callServerEndpoint`
falla con `no_web_url` y **el botón no hace nada**. Es el fallo más fácil de llevarse a
la revisión sin darse cuenta.

## 5 · Texto para App Store Connect

> **Notes for Review**
>
> Account deletion can be started from inside the app, as required by Guideline
> 5.1.1(v).
>
> Sign in with the demo account below, then go to **Perfil** (the last tab). At the
> bottom of that screen there is a red card, **"Eliminar mi cuenta"**. Tapping it opens
> a confirmation dialog that lists exactly what is deleted and what is kept; typing
> **ELIMINAR** enables the confirm button. Once confirmed, the account is deleted, the
> session is closed and the app shows a confirmation screen. Signing in again with the
> same credentials is rejected.
>
> Demo account: `jovimib+apple@gmail.com`
> Password: (see App Store Connect credentials field)
>
> Note: the deletion is irreversible, so the demo account can only be used once. If you
> need it reset during the review, please contact us at info.cognixlabs@gmail.com and we
> will restore it within a few hours.
>
> MisterFC is used by sports clubs to manage youth teams. The club is the data
> controller for the players' sporting records, so deleting a parent's account does not
> by itself delete the child's player record; the app offers a separate, explicit flow
> for that, and when the parent is the child's only guardian, deleting the account
> starts it automatically. Full details:
> https://misterfc.es/es/legal/eliminacion-cuenta

## 6 · Antes de enviar

- [ ] Build EAS con `EXPO_PUBLIC_WEB_URL` apuntando a la web de producción.
- [ ] **La cuenta que va en la ficha, con 0 bloqueantes** (§2) — medido sobre **esa**
      cuenta, no sobre `familia1`: el análisis del 2026-09-11 es de `familia1`, y la
      designada para Apple desde el 2026-09-26 es `jovimib+apple@gmail.com`, cuyo recuento
      de bloqueantes **no está medido en este documento**. Con un solo jugador bloqueante,
      el borrado se queda *pendiente* y el revisor ve una pantalla de espera.
- [ ] `node scripts/seed-test-accounts.mjs` ejecutado si hubo que recrear la cuenta.
- [ ] Texto legal de `/legal/eliminacion-cuenta` actualizado y aprobado (BC-8, pieza 1).
- [ ] Vídeo grabado con el plano final del login rechazado.
- [ ] Credenciales de la cuenta puestas en App Store Connect.

---

## 7 · La compra: cómo la prueba el revisor, y por qué hoy NO puede

> Esta sección es de SU-7. Lo de arriba (borrado de cuenta) sigue valiendo igual.

### 7.1 · El camino que tiene que ver el revisor

Con el gate encendido, el muro es **la primera pantalla** que ve una familia sin
suscripción, así que no hay que explicarle cómo llegar:

```
entrar con la cuenta de prueba  →  muro de suscripción
        →  precio y periodicidad visibles (los pone la tienda)
        →  «Suscribirme»  →  hoja de pago de Apple (sandbox)
        →  acceso a la app
```

Y en la misma pantalla, lo que el revisor comprueba de la lista de la Guideline 3.1.2:

| Lo que busca | Dónde está |
|---|---|
| Precio completo, visible | el `priceString` de la tienda, en grande |
| Duración y renovación automática | «al año, con renovación automática» |
| Cómo cancelar | el aviso del final |
| **Restaurar compras** (3.1.1) | botón propio, debajo del de comprar |
| **Enlace a condiciones de uso** | pie del muro (añadido en SU-7) |
| **Enlace a política de privacidad** | pie del muro (añadido en SU-7) |

### 7.2 · Por qué hacía falta SU-8 · RESUELTO

**Apple ejecuta la compra del revisor en el SANDBOX**, aunque el build vaya firmado para
producción. Es un caso conocido y documentado: un servidor que solo acepta recibos de
producción rechaza la compra del revisor, y la app se cae por Guideline 2.1. RevenueCat
valida los dos entornos por su cuenta, así que **nos manda el webhook con
`environment: SANDBOX`**.

**Y el revisor de Google Play, igual.** No es un caso aparte: la puerta de
`apply_subscription_event` se decide con `v_sandbox := upper(p_environment) <>
'PRODUCTION'` (migración `20261066000000`, línea 100) y **`p_store` no entra en ella** —
solo se guarda. Así que una compra del revisor de Play llega con `environment: SANDBOX`
y choca contra la misma reja: sin su fila en la lista, el evento se archiva con
`skipped_reason = 'sandbox'` y no concede nada. Por eso en la lista hay **dos**
designaciones y no una (§7.3). Medido el 2026-09-29 (E-6).

Y ahí chocaba con una decisión de SU-1, escrita a propósito: un evento que no fuera
`PRODUCTION` no aplicaba nada. Existe por un motivo bueno —que nadie con TestFlight se
abra la puerta de producción— pero tenía una consecuencia que no vi al escribirla: **la
compra del revisor no concedía nada**. El revisor pagaba, el muro le decía «tu pago se ha
registrado, pero la activación está tardando», y no entraba. Rechazo garantizado.

**Resuelto en SU-8** (migración `20261066000000`, aplicada) **y SU-8b**:

| Pieza | Qué hace |
|---|---|
| `subscription_test_profiles` | lista explícita de perfiles de prueba, con `motivo` obligatorio y `valid_until` que **caduca sola** |
| `apply_subscription_event` | aplica un evento de SANDBOX **si y solo si** el perfil está en la lista y la designación está vigente; para cualquier otra cuenta lo registra y NO lo aplica, igual que antes |
| ventana fija de 30 días | del sandbox **no se copia la fecha**: su reloj va acelerado (una anual renueva cada ~30-60 min y para a las ~6 veces), así que copiarla daría al revisor menos de una hora de acceso |
| reclamación (SU-8b) | deja de decidir: pasa el entorno tal cual al SQL, así que el rescate del revisor funciona también si su webhook se retrasa |

Y lo que **no** cambió, probado en pgTAP: la designación no gana a los candados de
ADR-0022 (cuenta anonimizada, fila desenganchada y el cable trampa del TRANSFER siguen
mandando), y una designación caducada vuelve a ser un `sandbox` normal.

### 7.3 · El paso que hay que dar antes de enviar

La lista **nace vacía**, y hasta que el perfil del revisor esté en ella su compra no
concede nada — o sea que esto no es un trámite, es el paso que hace que la revisión
funcione. Pero **hoy ya no está vacía**: el envío de octubre de 2026 dejó las dos
designaciones puestas. **Lo primero es mirar, no insertar.**

**Estado medido en producción el 2026-10-18** (lectura de `subscription_test_profiles`
contra `auth.users` y `public.profiles`):

| perfil | cuenta | para | vigente hasta (Europe/Madrid) | designada el |
|---|---|---|---|---|
| `33b2f09c` | `jovimib+jugador8@gmail.com` | revisor de **Google Play** | 2026-11-28 01:21 | 2026-09-29 |
| `ec4bb48f` | `jovimib+apple@gmail.com` | revisor de **Apple** | 2026-11-25 15:11 | 2026-09-26 |

Las dos vigentes, los dos perfiles existen y ninguno está anonimizado. Para un envío
hecho antes de esas fechas **no hay que tocar nada**.

> **Esta tabla caduca sola, y por eso lleva fecha.** No es la lista de cuentas de la
> casa: es una foto del 2026-10-18. Antes de cada envío se vuelve a mirar, porque lo
> que decide no es lo que pone aquí sino lo que hay en la fila.

Para mirarlo:

```sql
select left(tp.profile_id::text, 8) as perfil,
       u.email,
       tp.valid_until at time zone 'Europe/Madrid' as vigente_hasta,
       tp.valid_until > now() as vigente,
       tp.motivo
  from public.subscription_test_profiles tp
  join auth.users u on u.id = tp.profile_id
 order by tp.valid_until;
```

Y si falta alguna, o está caducada — el `email` es el parámetro, **no** una constante de
este documento: se pone el de la cuenta que de verdad va en App Store Connect / Play
Console (ver el recuadro de abajo):

```sql
-- `valid_until` con margen para toda la revisión y sus posibles reenvíos, no más.
insert into public.subscription_test_profiles (profile_id, motivo, valid_until)
select id, 'App Store review · envío ' || to_char(now(), 'YYYY-MM'), now() + interval '60 days'
  from auth.users
 where email = 'jovimib+apple@gmail.com'   -- ← la cuenta REAL de la ficha, no la del ejemplo
on conflict (profile_id) do update
  set motivo = excluded.motivo, valid_until = excluded.valid_until;
```

> **La designación y la cuenta de demo tienen que ser LA MISMA.** Es el único invariante
> de todo el §7, y no estaba escrito: si en App Store Connect va una cuenta y en la lista
> está designada otra, el revisor entra, paga y **no se le concede nada** — exactamente el
> rechazo que este apartado existe para evitar, y sin ninguna señal de que algo esté mal.
> Hasta el 2026-10-18 este documento nombraba `jovimib+familia1@gmail.com` en el §2, en
> el §5 y en el `insert`, mientras producción tenía designada `jovimib+apple@gmail.com`:
> quien hubiera seguido el documento al pie de la letra habría puesto en la ficha la
> cuenta que **no** está en la lista. Se comprueba mirando las dos cosas, no una.

> **Ojo con la cuenta de un solo uso.** Si se recrea `familia1` con
> `seed-test-accounts.mjs` (§3), el perfil es **otro**: el `profile_id` cambia y la
> designación vieja se queda apuntando a una cuenta anonimizada, que no aplica nada. Hay
> que volver a ejecutar el `insert` DESPUÉS de recrearla, no antes.

No hace falta quitar la designación al acabar: caduca sola por `valid_until`. Quitarla
antes de tiempo es un `DELETE` y no rompe nada.

### 7.4 · Y una cosa que el revisor va a preguntar

Con el gate encendido y sin suscripción **no se ve nada** (decisión 3 de Jose: muro y
punto). Un revisor que no consiga comprar tampoco podrá comprobar el resto de la app, ni
el borrado de cuenta del §1. Así que en las notas conviene decírselo antes de que lo
descubra: que el borrado está **dentro del muro**, alcanzable sin pagar, porque la
Guideline 5.1.1(v) manda por encima del muro.

### 7.5 · Texto para App Store Connect

> **Notes for Review — subscription**
>
> MisterFC is free to download. Club staff (coaches, coordinators, directors) get access
> as part of the club's own contract and are never asked to pay. **Parents, guardians and
> followers** need a personal auto-renewable subscription (1 year).
>
> After signing in with the demo account, the subscription screen is the first screen you
> see. It shows the price and the renewal terms, a **Restore Purchases** button, and links
> to our Terms of Use and Privacy Policy.
>
> Sandbox purchases made during review are recognised for the demo account, so you can
> complete the purchase and continue into the app.
>
> **Account deletion is reachable from inside the subscription screen**, without paying:
> Guideline 5.1.1(v) takes precedence over the paywall. See the account-deletion notes
> above.
>
> There is no way to subscribe outside the app: we do not offer any external payment
> method, and the web version only tells the user to subscribe from the app.

---

## 8 · Antes de enviar (suscripción)

- [ ] **Mirada a `subscription_test_profiles`** con el `select` del §7.3 — primero mirar,
      que las designaciones de un envío anterior pueden seguir vigentes. Sin fila vigente,
      la compra del revisor no concede acceso.
- [ ] **La cuenta de la ficha y la designada son la misma**, en las dos tiendas: el
      *demo account* de App Store Connect = el perfil designado para Apple, y el de Play
      Console = el designado para Play. Comprobado mirando las dos, no deducido.
- [ ] **Play también**: su revisor compra en SANDBOX igual que el de Apple (§7.2), así
      que necesita su propia fila. Una sola designación cubre una sola tienda.
- [ ] Si se ha recreado la cuenta de prueba, la designación **rehecha** con el
      `profile_id` nuevo.
- [ ] Build de EAS con **`EXPO_PUBLIC_SUBSCRIPTION_GATE=on`**: con el gate apagado el muro
      es inalcanzable y Apple no encuentra la compra que tiene que revisar.
- [ ] Build de EAS con `EXPO_PUBLIC_REVENUECAT_IOS_KEY` **y** `EXPO_PUBLIC_WEB_URL`.
- [ ] Producto `com.misterfc.app.suscripcion.anual` creado y con localización (nombre y
      descripción) — [fichas de tienda](su7-fichas-tienda.md).
- [ ] *Sandbox tester* creado en App Store Connect y **no** usado antes con esa compra.
- [ ] Enlaces legales comprobados **en el dispositivo**, abriendo los dos desde el muro.
- [ ] Texto legal de la suscripción aprobado y publicado
      ([propuesta](../specs/SU.7-legal-suscripcion-propuesta.md)).
- [ ] Precio de la app a **Free**.
