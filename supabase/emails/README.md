# Plantillas de correo (copia del repo)

Las plantillas que GoTrue manda de verdad **viven en el dashboard de Supabase**
(Authentication → Emails). Esta carpeta es la **copia revisada**: lo que debería
estar publicado. Existe para que haya rastro, para que un cambio se vea en un
diff y para que alguien pueda decir que no.

No es el origen de la verdad ni se despliega sola. Se pega a mano, a propósito.

| fichero | qué es | cuándo sale |
|---|---|---|
| `recovery.html` / `recovery.subject.txt` | Restablecer contraseña | Solo las versiones de la app **ya instaladas**, que aún llaman a `resetPasswordForEmail` |

## Eran tres. Por qué queda una

`invite` y `magic_link` se **retiraron del dashboard** al cerrar Correo-B. No las
disparaba ya nadie: los siete senders de invitación crean la cuenta con
`auth.admin.createUser` —que no manda correo— y mandan el suyo por Resend, en el
idioma del destinatario; y `signInWithOtp`, que era quien usaba el magic link, no
aparece en ningún fichero del repo. Lo vigila `check:invite-senders`.

`recovery` sigue viva por **calendario, no por diseño**. La web y la app nueva
piden su correo a `/api/auth/password-recovery`, que lo manda por Resend; pero las
versiones de la app que la gente ya tiene instalada siguen llamando a
`resetPasswordForEmail`, y ese camino usa esta plantilla. Se retira cuando el build
con las puertas nuevas esté fuera y las viejas hayan drenado.

## Lo que se aprendió retirando las otras dos

**Una plantilla vacía NO hace que GoTrue caiga a la suya por defecto.** Medido el
2026-09-21 al retirar `invite`: la Management API no acepta `null` (400), así que
lo único posible es dejar el contenido en blanco — y entonces el envío **falla**
(HTTP 500, *«Error sending invite email»*) y la cuenta no llega a crearse.

Para un camino retirado eso es lo correcto: falla a la vista en vez de mandar algo
raro en silencio. Pero conviene tenerlo escrito **antes** de retirar `recovery`:
hacerlo demasiado pronto significaría que quien pida su contraseña desde una app
vieja no recibe nada, y solo se enteraría él.

## Lo que hay que saber antes de tocar la que queda

**El enlace.** `recovery` usa `{{ .ConfirmationURL }}`, porque ahí el artefacto de
sesión **es** el trámite. Que ese enlace lleve DIRECTO a `/{locale}/reset-password`
—el arreglo del BUG 4— lo sostiene `recoveryRedirectTo` en core y lo vigila
`check:correo-recuperacion`.

**`.Data` siempre dentro de `{{ with .Data }}`.** `auth.users.raw_user_meta_data`
es nullable y no tiene default. Con `.Data` nulo, `eq .Data.loquesea "x"` no cae
en la rama neutra: revienta el render y **el correo no se manda**.

**El asunto también es una plantilla.** Medido en GoTrue v2.197
(`internal/mailer/templatemailer/template.go`): se parsea con
`template.New("Subject")` y se ejecuta con el mismo mapa de datos que el cuerpo.

**Y el asunto cabe en 255 caracteres, sintaxis incluida.** Es un límite del
dashboard, no nuestro: con uno más largo contesta *«Failed to validate template:
subject: Too big»* y **no guarda nada**, ni el asunto ni el cuerpo. El primer
asunto ramificado medía 411 y se quedó sin pegar; el rechazo pasó desapercibido
hasta que `plantillas:diff` dijo que el dashboard seguía con la plantilla vieja.
Lo vigila el guard.

**El formulario del dashboard no traga sintaxis de plantilla en el asunto.**
Medido el 2026-09-19 con la de invitación: respondía *«Failed to update email
templates»*. La **Management API sí la acepta** (se probaron ocho variantes y
entraron las ocho). Por eso existe `plantillas:aplicar`: sin él, esta carpeta
sería un museo.

## Los tres comandos

```bash
pnpm check:plantillas-correo          # en CI. No habla con Supabase.
pnpm plantillas:diff                  # a mano. Lee y compara. No escribe.
pnpm plantillas:aplicar recovery      # ensayo: enseña qué cambiaría
pnpm plantillas:aplicar recovery --si # lo aplica, y lo relee para verificarlo
```

`aplicar` va de una en una y exige `--si`. No corre en CI ni se dispara solo.

El diff es el que dice si el dashboard se ha movido, y **no corre en CI** porque el
workflow no tiene secretos (y así se queda). Conviene lanzarlo al tocar una
plantilla: una copia que nadie compara acaba siendo una copia que miente.
