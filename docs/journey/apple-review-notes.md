# Notas de revisión para Apple — borrado de cuenta

> **Qué es esto**: lo que hay que pegar en *App Store Connect → App Review Information*
> y cómo dejar la cuenta de prueba en el estado correcto antes de enviar.
> **Por qué existe**: Apple bloqueó la publicación con la **Guideline 5.1.1(v)** — una app
> que da acceso a cuentas debe permitir **iniciar el borrado de la cuenta desde dentro de
> la app**. La serie BC lo construye; esto es lo que se le enseña al revisor.

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
