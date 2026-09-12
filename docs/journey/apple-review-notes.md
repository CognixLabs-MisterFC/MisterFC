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

**`jovimib+familia1@gmail.com`** · contraseña: la constante `PASSWORD` de
[seed-test-accounts.mjs](../../apps/web/scripts/seed-test-accounts.mjs).

Es la correcta porque **no es único tutor de ningún jugador**: está vinculada a Jose
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
> Demo account: `jovimib+familia1@gmail.com`
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
- [ ] `node scripts/seed-test-accounts.mjs` ejecutado y `familia1` con **0 bloqueantes**.
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

La lista **nace y vive vacía**. Hasta que el perfil del revisor esté en ella, su compra
sigue sin conceder nada — o sea que esto no es un trámite, es el paso que hace que la
revisión funcione:

```sql
-- El `profile_id` es el de la cuenta de prueba (`jovimib+familia1@gmail.com`, §2).
-- `valid_until` con margen para toda la revisión y sus posibles reenvíos, no más.
insert into public.subscription_test_profiles (profile_id, motivo, valid_until)
select id, 'App Store review · envío ' || to_char(now(), 'YYYY-MM'), now() + interval '60 days'
  from auth.users
 where email = 'jovimib+familia1@gmail.com'
on conflict (profile_id) do update
  set motivo = excluded.motivo, valid_until = excluded.valid_until;
```

Y para comprobar que la designación está donde tiene que estar:

```sql
select left(profile_id::text, 8) as perfil, motivo, valid_until > now() as vigente
  from public.subscription_test_profiles;
```

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

- [ ] **El perfil del revisor, en `subscription_test_profiles`** con la designación
      vigente (§7.3). SU-8 ya está aplicado, pero la lista nace vacía: sin esta fila, la
      compra del revisor sigue sin conceder acceso.
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
